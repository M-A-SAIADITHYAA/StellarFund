#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, token, Address, Env, Symbol, Vec};

/// Storage keys for the crowdfunding campaign state.
#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    /// The campaign owner's address
    Owner,
    /// The token contract address (native XLM SAC wrapper)
    Token,
    /// The fundraising goal in stroops
    Goal,
    /// The deadline as a ledger timestamp
    Deadline,
    /// Total amount raised so far
    Raised,
    /// Whether the campaign has ended (withdrawn/refunded)
    Ended,
    /// Individual donor contribution tracking
    Donor(Address),
}

/// Campaign state returned by get_state
#[derive(Clone)]
#[contracttype]
pub struct CampaignState {
    pub owner: Address,
    pub token: Address,
    pub goal: i128,
    pub raised: i128,
    pub deadline: u64,
    pub ended: bool,
    pub donor_count: u32,
}

/// Event topics
const TOPIC_INIT: &str = "initialized";
const TOPIC_DONATE: &str = "donated";
const TOPIC_WITHDRAW: &str = "withdrawn";
const TOPIC_REFUND: &str = "refunded";

#[contract]
pub struct CrowdfundContract;

#[contractimpl]
impl CrowdfundContract {
    /// Initialize the crowdfunding campaign.
    /// Can only be called once.
    ///
    /// # Arguments
    /// * `owner` - The campaign creator who can withdraw funds
    /// * `token` - The token contract address (native XLM SAC)
    /// * `goal` - The fundraising goal amount (in stroops)
    /// * `deadline` - Unix timestamp for the campaign deadline
    pub fn initialize(env: Env, owner: Address, token: Address, goal: i128, deadline: u64) {
        // Ensure not already initialized
        if env.storage().instance().has(&DataKey::Owner) {
            panic!("Campaign already initialized");
        }

        // Require owner authorization
        owner.require_auth();

        // Validate inputs
        if goal <= 0 {
            panic!("Goal must be positive");
        }

        // Store campaign parameters
        env.storage().instance().set(&DataKey::Owner, &owner);
        env.storage().instance().set(&DataKey::Token, &token);
        env.storage().instance().set(&DataKey::Goal, &goal);
        env.storage().instance().set(&DataKey::Deadline, &deadline);
        env.storage().instance().set(&DataKey::Raised, &0i128);
        env.storage().instance().set(&DataKey::Ended, &false);

        // Emit initialization event
        env.events().publish(
            (Symbol::new(&env, TOPIC_INIT),),
            (owner, goal, deadline),
        );
    }

    /// Donate tokens to the campaign.
    ///
    /// # Arguments
    /// * `donor` - The address making the donation
    /// * `amount` - The amount to donate (in stroops)
    ///
    /// # Errors
    /// Panics if campaign ended, deadline passed, or amount <= 0
    pub fn donate(env: Env, donor: Address, amount: i128) {
        // Require donor authorization
        donor.require_auth();

        // Check campaign is still active
        let ended: bool = env.storage().instance().get(&DataKey::Ended).unwrap_or(false);
        if ended {
            panic!("Campaign has ended");
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() > deadline {
            panic!("Campaign deadline has passed");
        }

        if amount <= 0 {
            panic!("Donation amount must be positive");
        }

        // Transfer tokens from donor to this contract
        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&donor, &env.current_contract_address(), &amount);

        // Update raised total
        let mut raised: i128 = env.storage().instance().get(&DataKey::Raised).unwrap_or(0);
        raised += amount;
        env.storage().instance().set(&DataKey::Raised, &raised);

        // Track individual donor contribution
        let donor_key = DataKey::Donor(donor.clone());
        let mut donor_total: i128 = env.storage().persistent().get(&donor_key).unwrap_or(0);
        donor_total += amount;
        env.storage().persistent().set(&donor_key, &donor_total);

        // Emit donation event
        env.events().publish(
            (Symbol::new(&env, TOPIC_DONATE),),
            (donor, amount, raised),
        );
    }

    /// Withdraw all raised funds. Only callable by the campaign owner
    /// when the goal has been reached.
    pub fn withdraw(env: Env) {
        let owner: Address = env.storage().instance().get(&DataKey::Owner).unwrap();
        owner.require_auth();

        let ended: bool = env.storage().instance().get(&DataKey::Ended).unwrap_or(false);
        if ended {
            panic!("Campaign has already ended");
        }

        let raised: i128 = env.storage().instance().get(&DataKey::Raised).unwrap_or(0);
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();

        if raised < goal {
            panic!("Fundraising goal not yet reached");
        }

        // Transfer all raised funds to the owner
        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &owner, &raised);

        // Mark campaign as ended
        env.storage().instance().set(&DataKey::Ended, &true);
        env.storage().instance().set(&DataKey::Raised, &0i128);

        // Emit withdrawal event
        env.events().publish(
            (Symbol::new(&env, TOPIC_WITHDRAW),),
            (owner, raised),
        );
    }

    /// Refund a donor's contribution. Only callable after the deadline
    /// has passed and the goal was NOT reached.
    ///
    /// # Arguments
    /// * `donor` - The donor requesting a refund
    pub fn refund(env: Env, donor: Address) {
        donor.require_auth();

        let ended: bool = env.storage().instance().get(&DataKey::Ended).unwrap_or(false);
        if ended {
            panic!("Campaign has already ended");
        }

        let deadline: u64 = env.storage().instance().get(&DataKey::Deadline).unwrap();
        if env.ledger().timestamp() <= deadline {
            panic!("Campaign deadline has not passed yet");
        }

        let raised: i128 = env.storage().instance().get(&DataKey::Raised).unwrap_or(0);
        let goal: i128 = env.storage().instance().get(&DataKey::Goal).unwrap();

        if raised >= goal {
            panic!("Goal was reached, refunds not available");
        }

        // Get donor's contribution
        let donor_key = DataKey::Donor(donor.clone());
        let donor_amount: i128 = env.storage().persistent().get(&donor_key).unwrap_or(0);

        if donor_amount <= 0 {
            panic!("No donation found for this address");
        }

        // Transfer refund back to donor
        let token_address: Address = env.storage().instance().get(&DataKey::Token).unwrap();
        let token_client = token::Client::new(&env, &token_address);
        token_client.transfer(&env.current_contract_address(), &donor, &donor_amount);

        // Update state
        let new_raised = raised - donor_amount;
        env.storage().instance().set(&DataKey::Raised, &new_raised);
        env.storage().persistent().remove(&donor_key);

        // Emit refund event
        env.events().publish(
            (Symbol::new(&env, TOPIC_REFUND),),
            (donor, donor_amount),
        );
    }

    /// Get the current campaign state. Read-only.
    pub fn get_state(env: Env) -> CampaignState {
        CampaignState {
            owner: env.storage().instance().get(&DataKey::Owner).unwrap(),
            token: env.storage().instance().get(&DataKey::Token).unwrap(),
            goal: env.storage().instance().get(&DataKey::Goal).unwrap(),
            raised: env.storage().instance().get(&DataKey::Raised).unwrap_or(0),
            deadline: env.storage().instance().get(&DataKey::Deadline).unwrap(),
            ended: env.storage().instance().get(&DataKey::Ended).unwrap_or(false),
            donor_count: 0, // Simplified: would need enumeration in production
        }
    }

    /// Get a specific donor's total contribution.
    pub fn get_donation(env: Env, donor: Address) -> i128 {
        let donor_key = DataKey::Donor(donor);
        env.storage().persistent().get(&donor_key).unwrap_or(0)
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::{token, Address, Env};

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(CrowdfundContract, ());
        let client = CrowdfundContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let token = env.register_stellar_asset_contract_v2(owner.clone()).address().clone();
        let goal: i128 = 1_000_000_000; // 100 XLM in stroops
        let deadline: u64 = 1_000_000;

        client.initialize(&owner, &token, &goal, &deadline);

        let state = client.get_state();
        assert_eq!(state.owner, owner);
        assert_eq!(state.goal, goal);
        assert_eq!(state.raised, 0);
        assert_eq!(state.ended, false);
    }

    #[test]
    fn test_donate() {
        let env = Env::default();
        env.mock_all_auths();

        let contract_id = env.register(CrowdfundContract, ());
        let client = CrowdfundContractClient::new(&env, &contract_id);

        let owner = Address::generate(&env);
        let token_admin = Address::generate(&env);
        let token_addr = env.register_stellar_asset_contract_v2(token_admin.clone()).address().clone();
        let goal: i128 = 1_000_000_000;
        let deadline: u64 = 1_000_000;

        client.initialize(&owner, &token_addr, &goal, &deadline);

        // Mint tokens to a donor
        let donor = Address::generate(&env);
        let token_client = token::StellarAssetClient::new(&env, &token_addr);
        token_client.mint(&donor, &500_000_000);

        // Donate
        let amount: i128 = 100_000_000; // 10 XLM
        client.donate(&donor, &amount);

        let state = client.get_state();
        assert_eq!(state.raised, amount);

        let donation = client.get_donation(&donor);
        assert_eq!(donation, amount);
    }
}
