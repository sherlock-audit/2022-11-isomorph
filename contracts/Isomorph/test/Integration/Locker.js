// We import Chai to use its asserting functions here.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { helpers } = require("../testHelpers.js")
const { addresses } = require("../deployedAddresses.js")
const { ABIs } = require("../abi.js");


async function impersonateForToken(provider, receiver, ERC20, donerAddress, amount) {
    let tokens_before = await ERC20.balanceOf(receiver.address)
    await network.provider.request({
        method: "hardhat_impersonateAccount",
        params: [donerAddress],
    });
    const signer = await provider.getSigner(donerAddress)
    await ERC20.connect(signer).transfer(receiver.address, amount)
    await network.provider.request({
        method: "hardhat_stopImpersonatingAccount",
        params: [donerAddress]
    });
    let tokens_after = await ERC20.balanceOf(receiver.address)
    expect(tokens_after).to.equal(tokens_before.add(amount))

}


describe("Integration tests: Locker contract", function() {



    let owner; //0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
    let alice; //0x70997970c51812dc3a010c7d01b50e0d17dc79c8
    let bob; //0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc
    let addrs;
    let signer;
    let fake_addr; //used when we need an unrelated address
    const ZERO_ADDRESS = ethers.constants.AddressZero
    const FOUR_YEARS = 4*365*24*60*60 
    const TWO_YEARS = 2*365*24*60*60 
    const ONE_WEEK = 7*24*60*60
    const FULL_WEIGHT = 10000;

    //fetch predeployed addresses
    const OP_address = addresses.optimism.OP_Token
    const VELO_address = addresses.optimism.VELO
    const voter_address = addresses.optimism.Velo_Voter
    const voting_escrow_address = addresses.optimism.Velo_Voting_Escrow
    const router_address = addresses.optimism.Velo_Router
    const rewards_distributor_address = addresses.optimism.Velo_Rewards_Distributor
    const sAMM_USDC_sUSD = addresses.optimism.sAMM_USDC_sUSD
    const vAMM_VELO_OP = addresses.optimism.vAMM_VELO_OP
    const depositorAddress = "0x3460dc71a8863710d1c907b8d9d5dbc053a4102d"
    

    const VELO_doner = "0x9a69A19f189585dA168C6f125aC23Db866CAFF11" //addresses.optimism.VELO_Doner
    console.log("DONER SETUP ", VELO_doner)

    //grab the provider endpoint
    const provider = ethers.provider

    VELO = new ethers.Contract(VELO_address, ABIs.ERC20, provider)
    OP = new ethers.Contract(OP_address, ABIs.ERC20, provider)
    voter = new ethers.Contract(voter_address, ABIs.Voter, provider)
    
    voting_escrow = new ethers.Contract(voting_escrow_address, ABIs.Voting_Escrow, provider)
    router = new ethers.Contract(router_address, ABIs.Router, provider)

    let RD_ABI = [
        "function claimable(uint256) external view returns(uint256)",
        "function time_cursor_of(uint256) external view returns(uint256)",
        "function start_time() external view returns(uint256)",
        "function last_token_time() external view returns(uint256)"
    ]

    rewardsDistributor = new ethers.Contract(rewards_distributor_address, RD_ABI, provider)
    

    
    
    //default sending amount for VELO
    let amount = ethers.utils.parseEther('10000');

    //var to store the outcome of an event arg in for manual verification
    let capturedValue
    
    function captureValue(value) {
        capturedValue = value
        return true
    }
    
    let locker;

    before(async function() {
        //this.timeout(1000000);
        // Get the ContractFactory and Signers here 


        [owner, alice, bob, ...addrs] = await ethers.getSigners()
        fake_addr = addrs[0].address
        console.log('Block Index at start ', await provider.getBlockNumber())
        //console.log("PROVIDER ", provider);  
        let doner_amount = ethers.utils.parseEther('200000') //20_000 VELO;

        //borrow VELO tokens from doner addresses 
        impersonateForToken(provider, owner, VELO, VELO_doner, doner_amount)


        //deploy locker
        const Locker = await ethers.getContractFactory("Locker")
        locker = await Locker.deploy(
            VELO.address, 
            voter.address, 
            voting_escrow.address, 
            rewards_distributor_address
            )

        //transfer VELO tokens to locker
        await VELO.connect(owner).transfer(locker.address, amount.mul(2))

        //find external bribe via voter and pool's gauge
        external_bribe_address = "0xBee1E4C4276687A8350C2E44eCBe79d676637f86" //await voter.external_bribes(addresses.optimism.gauge_USDC_SUSD)
        external_bribe = new ethers.Contract(external_bribe_address, ABIs.External_Bribe, provider)
        
        
    });

    beforeEach(async () => {
        snapshotId = await helpers.snapshot(provider)
        //console.log('Snapshotted at ', await provider.getBlockNumber());
    });

    afterEach(async () => {
        await helpers.revertChainSnapshot(provider, snapshotId)
        //console.log('Reset block heigh to ', await provider.getBlockNumber());
    });

    describe("Construction", function() {
        it("Should deploy the right constructor addresses", async function() {
            expect(await locker.velo()).to.equal(VELO.address)
            expect(await locker.voter()).to.equal(voter.address)
            expect(await locker.votingEscrow()).to.equal(voting_escrow.address)

        });
    });

    describe("lockVELO", function() {
        
        
        it("Should lock specified VELO into veNFT", async function() {
            let balance_before = await VELO.balanceOf(locker.address)
            //call to lock velo and check emitted event
            await expect(locker.lockVELO(amount, FOUR_YEARS)).to.emit(locker, 'GenerateVeNFT') //.withArgs(captureValue, amount, FOUR_YEARS) 
            //fetch veNFT ID
            let id = await locker.veNFTIds(0)
            //check event emitted right Id
            //expect(capturedValue).to.equal(id)

            //check locker balance of VELO after locking
            let balance_after = await VELO.balanceOf(locker.address)
            expect(balance_after).to.equal(balance_before.sub(amount))

            //check ownership of new veNFT
            let nft_owner = await voting_escrow.ownerOf(id)
            expect(nft_owner).to.equal(locker.address)
            
            //check voting power of new veNFT, near time zero from minting this should match VELO sent to create veNFT
            let voting_balance = await voting_escrow.balanceOfNFT(id)
            let error = amount.div(200) //0.5%
            expect(voting_balance).to.be.closeTo(amount, error)

        });

        it("Should revert when called by the wrong user", async function() {
            await expect(locker.connect(alice).lockVELO(amount, FOUR_YEARS))
                .to.be.revertedWith("Only callable by owner")
            

        });
    });

    describe("relockVELO", function() {
        let amount = ethers.utils.parseEther('10000');
        let id
        beforeEach(async function () {
            //lock VELO into a veNFT before attempting a relock            
            await locker.lockVELO(amount, TWO_YEARS)
            //fetch veNFT ID
            id = await locker.veNFTIds(0)
            
    
        })

        it("Should relock specified veNFT increasing locktime", async function() {
            let balance_before = await VELO.balanceOf(locker.address)

            let voting_balance_before = await voting_escrow.balanceOfNFT(id)
            //check voting power is half of amount as we are at half max lock time and voting decay is linear
            let error = (amount.div(2)).div(100) //allow an error of 1%
            expect(voting_balance_before).to.be.closeTo(amount.div(2), error)

            //Do relockVELO() call and check emitted event
            await expect(locker.relockVELO(id, FOUR_YEARS))
                .to.emit(locker, 'RelockVeNFT').withArgs(id, FOUR_YEARS);
            
            //check locker balance of VELO is the same after relocking 
            let balance_after = await VELO.balanceOf(locker.address)
            expect(balance_after).to.equal(balance_before)
            
            //check new voting power of veNFT should now nearly match amount as we are at max lock time
            let voting_balance = await voting_escrow.balanceOfNFT(id)
            error = amount.div(200) //allow an error of 0.5% due to time..?
            expect(voting_balance).to.be.closeTo(amount, error)

        });

        it("Should revert when called by the wrong user", async function() {
            await expect(locker.connect(alice).relockVELO(id, 1))
                .to.be.revertedWith("Only callable by owner")
            

        });
    });
    
    describe("vote", function() {
        let amount = ethers.utils.parseEther('10000');
        let ids = []
        let time_increase = 20 //time increase to get a known block timestamp
        let last_timestamp

        beforeEach(async function () {
            //lock VELO into two veNFTs before attempting to vote
            await locker.lockVELO(amount, FOUR_YEARS)
            tx = await locker.lockVELO(amount, FOUR_YEARS)
            const block = await ethers.provider.getBlock(tx.blockNumber)
            last_timestamp = block.timestamp
            //fetch veNFT IDs
            ids = [] //stop ids from duplicating, otherwise voting calls will revert
            ids.push(await locker.veNFTIds(0))
            ids.push(await locker.veNFTIds(1))
    
        })

        it("Should be able to vote with a single veNFT", async function() {
            this.timeout(100000);
            //force a certain timestamp to make checking the emitted event easier
            let new_timestamp = last_timestamp + time_increase
            await helpers.timeSkip(time_increase)
            await expect(locker.vote([ids[0]],[sAMM_USDC_sUSD], [FULL_WEIGHT])
                ).to.emit(locker, 'NFTVoted')
                //.withArgs(ids[0], new_timestamp)
                //.to.emit(voter, 'Voted')
                //.withArgs(locker.address, ids[0], FULL_WEIGHT)

            

        });
        //problems to fix, 'Voted' events state specified args are not emitted,
        // how to capture block.timestamp WITHOUT capturing tx, finding block and then getting it? I.e. syncronously
        it("Should be able to vote with a single veNFT for multiple pools", async function() {
            this.timeout(100000)
            vAMM_WETH_BIFI = "0x17d99c78F1AA7870ab30FB3E93b2fE9F6502d192"
            TEN_PERCENT = 1000
            let new_timestamp = last_timestamp + time_increase
            await helpers.timeSkip(time_increase)
            await expect(locker.vote([ids[0]],[sAMM_USDC_sUSD, vAMM_WETH_BIFI], [FULL_WEIGHT- TEN_PERCENT, TEN_PERCENT])
                ).to.emit(voter, 'Voted').to.emit(voter, 'Voted').to.emit(locker, 'NFTVoted')
                //.withArgs(locker.address, ids[0], FULL_WEIGHT- TEN_PERCENT)
                
                //.withArgs(locker.address, ids[0], TEN_PERCENT);
                
                //.withArgs(ids[0], new_timestamp)
            
            //const receipt = tx.wait()
            //const block = await ethers.provider.getBlock(tx.blockNumber);
            //console.log("EVENTS ", receipt.events)
            //for (const event of receipt.events) {
            //    console.log(`Event ${event.event} with args ${event.args}`);
            //}

            //expect(tx).to.emit(locker, 'Voted').withArgs(ids[0], block.timestamp)

        });

        //problems to fix, 'Voted' events state specified args are not emitted,
        // how to capture block.timestamp WITHOUT capturing tx, finding block and then getting it? I.e. syncronously
        it("Should be able to vote with multiple veNFTs", async function() {
            
            let new_timestamp = last_timestamp + time_increase
            await helpers.timeSkip(time_increase)

            await  expect(locker.vote(ids,[sAMM_USDC_sUSD], [FULL_WEIGHT])
                ).to.emit(locker, 'NFTVoted').to.emit(locker, 'NFTVoted').to.emit(voter, 'Voted').to.emit(voter, 'Voted')
                
                // check for locker events
                //.withArgs(ids[0], new_timestamp)
                
                //.withArgs(ids[1], new_timestamp)
                 //check for Velodrome's Voter.sol emitting events
                //.withArgs(locker.address, ids[0], FULL_WEIGHT)
                
                //.withArgs(locker.address, ids[1], FULL_WEIGHT)

        });

        it("Should revert when called by the wrong user", async function() {
            await expect(locker.connect(alice).vote([ids[0]], [sAMM_USDC_sUSD], [FULL_WEIGHT]))
                .to.be.revertedWith("Only callable by owner")
            

        });
    });

    describe("removeERC20Tokens", function() {
        let amount = ethers.utils.parseEther('10000')
        let withdraw_amount_A = ethers.utils.parseEther('4000')
        let withdraw_amount_B = ethers.utils.parseEther('5452')
        let ids = []
        before(async function () {
            //deploy ERC20 Tokens
            TESTERC20 = await ethers.getContractFactory("TESTERC20Token")
            token_A = await TESTERC20.deploy("Token A", "TEST")
            token_B = await TESTERC20.deploy("Token B", "TEST")
            token_A.connect(owner).transfer(locker.address, amount)
            token_B.connect(owner).transfer(locker.address, amount)
    
        })

        it("Should be able to remove accumulated ERC20s from Locker", async function() {
            
            let balance_before_A = await token_A.balanceOf(locker.address)
            let balance_before_B = await token_B.balanceOf(locker.address)
            await expect(locker.removeERC20Tokens([token_A.address, token_B.address], [withdraw_amount_A, withdraw_amount_B])
                ).to.emit(locker, 'RemoveExcessTokens').withArgs(token_A.address, owner.address, withdraw_amount_A
                ).to.emit(locker, 'RemoveExcessTokens').withArgs(token_B.address, owner.address, withdraw_amount_B)
            
            
            let balance_after_A = await token_A.balanceOf(locker.address)
            let balance_after_B = await token_B.balanceOf(locker.address)
            expect(balance_after_A).to.equal(balance_before_A.sub(withdraw_amount_A))
            expect(balance_after_B).to.equal(balance_before_B.sub(withdraw_amount_B))

        });


        it("Should revert when called by the wrong user", async function() {
            await expect(locker.connect(alice).removeERC20Tokens([token_A.address, token_B.address], [withdraw_amount_A, withdraw_amount_B]))
                .to.be.revertedWith("Only callable by owner")
            

        });

        it("Should revert when array lengths do not match", async function() {
            await expect(locker.connect(owner).removeERC20Tokens([token_A.address, token_B.address], [withdraw_amount_A]))
                .to.be.revertedWith("Mismatched arrays")
            

        });
    });

    describe("withdrawNFT", function() {
        let amount = ethers.utils.parseEther('10000')
        let id
        let slot

        beforeEach(async function () {
            //lock VELO into a veNFT before attempting a relock
            //lock times are rounded to weeks so 1 week is minimum
            await locker.lockVELO(amount, ONE_WEEK)
            //fetch veNFT ID
            id = await locker.veNFTIds(0)
            slot = 0
            
    
        })

        it("Should be able to withdraw a veNFT ", async function() {

            //move time ahead so locked veNFT can be withdrawn
            helpers.timeSkip(ONE_WEEK +1) 

            let balance_before = await VELO.balanceOf(locker.address)
            
            let locked_tokens = await voting_escrow.locked(id)

            //Do withdrawNFT() call and check emitted event
            await expect(locker.withdrawNFT(id, slot)
                ).to.emit(locker, 'WithdrawVeNFT').to.emit(voting_escrow, 'Withdraw').to.emit(voting_escrow, 'Supply')
                //.withArgs(id, timestamp);
                
                //.withArgs()
                
                //.withArgs()
            
            //check locker balance of VELO is replenished  
            let balance_after = await VELO.balanceOf(locker.address)
            expect(balance_after).to.equal(balance_before.add(locked_tokens))

            let old_slot = await locker.veNFTIds(0)
            expect(old_slot).to.equal(0)

        });

        it("Should revert when called by the wrong user", async function() {
            await expect(locker.connect(alice).withdrawNFT(id, slot))
                .to.be.revertedWith("Only callable by owner")
            

        });

        it("Should revert if id and slot do not match", async function() {
            let bad_id = 76
            await expect(locker.connect(owner).withdrawNFT(bad_id, slot))
                .to.be.revertedWith("Wrong index slot")
            

        });
    });
    
    describe("claimBribesMultiNFTs", function() {
        let amount = ethers.utils.parseEther('10000')
        let withdraw_amount = ethers.utils.parseEther('4000')
        let ids = []

    
        it("Should let anyone call and accumulated bribes for pool voted for by veNFTs", async function() {
            this.timeout(200000)
            //lock VELO as veNFTs
            //lock VELO into two veNFTs before attempting to vote
            await locker.lockVELO(amount, FOUR_YEARS)
            await locker.lockVELO(amount, FOUR_YEARS)
            
            //fetch veNFT IDs
            //console.log("store IDs")
            ids.push(await locker.veNFTIds(0))
            ids.push(await locker.veNFTIds(1))

            //vote for pool
            await locker.vote(ids,[sAMM_USDC_sUSD], [FULL_WEIGHT])
           
            //timeskip into next epoch
            helpers.timeSkip(ONE_WEEK+1)
           
            //view earned bribe
            let bribe_token = OP.address
            
            //vote in new epoch to trigger checkpoint
            await locker.vote(ids,[sAMM_USDC_sUSD], [FULL_WEIGHT])

            let bribe_earned = await external_bribe.earned(bribe_token, ids[0])


            bribe_earned = bribe_earned.add(await external_bribe.earned(bribe_token, ids[1]))

            let balance_before = await OP.balanceOf(locker.address)

            //claim earned bribe
            await locker.connect(alice).claimBribesMultiNFTs([external_bribe.address], [[OP.address]], ids)

            let balance_after = await OP.balanceOf(locker.address)
            expect(balance_after.gt(balance_before)).to.equal(true)
            expect(balance_after).to.equal(balance_before.add(bribe_earned))
        });

    });

    describe("claimFeesMultiNFTs", function() {
        let amount = ethers.utils.parseEther('10000')
        let withdraw_amount = ethers.utils.parseEther('4000')
        let ids = []

        it("Should let anyone call and accumulated fees for pool voted for by veNFTs", async function() {
            this.timeout(200000)
            //lock VELO as veNFTs
            //lock VELO into two veNFTs before attempting to vote
            await locker.lockVELO(amount, FOUR_YEARS)
            
            //fetch veNFT IDs
            //console.log("store IDs")
            ids.push(await locker.veNFTIds(0))
            

            //vote for pool
            await locker.vote(ids,[vAMM_VELO_OP], [FULL_WEIGHT])
            
            //Do pool swap to accumulate fees
            let amountOutMin = 10
            let deadline = 1981351922 //year 2032
            await VELO.connect(owner).approve(router.address, amount)
            await router.connect(owner).swapExactTokensForTokensSimple(amount, amountOutMin, VELO.address, OP.address, false, owner.address, deadline)

            let balance_before = await VELO.balanceOf(locker.address)
            let gauge_VELO_OP = await voter.gauges(vAMM_VELO_OP)
            let internal_bribe_address = await voter.internal_bribes(gauge_VELO_OP)
            //claim earned bribe
            await locker.connect(alice).claimFeesMultiNFTs([internal_bribe_address], [[VELO.address]], ids)

            let balance_after = await VELO.balanceOf(locker.address)
            //check within a check to prevent complaints about expecting a number or data rather than BigNum
            expect(balance_after.gt(balance_before)).to.equal(true)
        });

    });


    //This does not work as intended yet, function calls work but no rebase is claimed
    describe("claimRebaseMultiNFTs", function() {
        let amount = ethers.utils.parseEther('10000')
        let withdraw_amount = ethers.utils.parseEther('4000')
        let ids = []

        it("Should let anyone call and process rebases owned to Locker", async function() {
            this.timeout(200000)
            //lock VELO as veNFTs
            //lock VELO into two veNFTs before attempting to vote
            await locker.lockVELO(amount, FOUR_YEARS)
            await locker.lockVELO(amount, FOUR_YEARS)
            
            //fetch veNFT IDs
            ids.push(await locker.veNFTIds(0))
            ids.push(await locker.veNFTIds(1))

            //vote for pool to be realistic
            await locker.vote(ids,[sAMM_USDC_sUSD], [FULL_WEIGHT])
           
            //timeskip into next epoch
            helpers.timeSkip(ONE_WEEK+1)
           

            //set up the VELO minter so we can distribute global rebase/new tokens by calling update_period
            let minter_ABI = [
                "function update_period() external returns(uint256)",
                
            ]
            minter = new ethers.Contract(depositorAddress, minter_ABI, provider)

            //update period 
            await minter.connect(alice).update_period()
            //then timeskip to a new epoch again and update period again as 2 periods must pass before rebase can be claimed
            helpers.timeSkip(ONE_WEEK+1)
            await minter.connect(alice).update_period()

            //check locked voting balances
            let balance_before = await voting_escrow.locked(ids[0])
            let balance_before_2 = await voting_escrow.locked(ids[1])
            
            //check rebase claimable per veNFT, the same as each veNFT has the same locked token amounts
            rewards = await rewardsDistributor.claimable(ids[0])

            await locker.connect(alice).claimRebaseMultiNFTs(ids)

            //check locked voting balances after claiming rebases
            let balance_after = await voting_escrow.locked(ids[0])
            let balance_after_2 = await voting_escrow.locked(ids[1])
            
            //verify expected behaviour
            //first check is to prevent success when rewards are zero
            expect(balance_after.gt(balance_before)).to.equal(true)
            expect(balance_after_2.gt(balance_before_2)).to.equal(true)

            expect(balance_after).to.equal(balance_before.add(rewards))
            expect(balance_after_2).to.equal(balance_before_2.add(rewards))
            
        });

    });

    describe("transferNFTs", function() {
        let amount = ethers.utils.parseEther('1000');
        let ids = []
        let indexes = [0,1]
        beforeEach(async function () {
            this.timeout(100000)
            //lock VELO into a veNFT before attempting a relock            
            await locker.lockVELO(amount, TWO_YEARS)
            await locker.lockVELO(amount, TWO_YEARS)
            await locker.lockVELO(amount, TWO_YEARS)
            //fetch veNFT ID
            ids = []
            ids.push(await locker.veNFTIds(0))
            ids.push(await locker.veNFTIds(1))
            ids.push(await locker.veNFTIds(2))
            
    
        })

        it("Should transfer NFTs to caller", async function() {
            
            //verify ownership prior to test
            expect( await voting_escrow.ownerOf(ids[0])).to.equal(locker.address)

            //Do transferNFTs() call 
            await locker.transferNFTs([ids[0]], [0])
            
            //verify ownership changed
            expect( await voting_escrow.ownerOf(ids[0])).to.equal(owner.address)

            //verify ownership prior to test
            expect( await voting_escrow.ownerOf(ids[1])).to.equal(locker.address)
            expect( await voting_escrow.ownerOf(ids[2])).to.equal(locker.address)
            
            //Do transferNFTs() call
            await locker.transferNFTs([ids[1], ids[2]], [1,2])
            
            //verify ownership of both NFTs changed
            expect( await voting_escrow.ownerOf(ids[1])).to.equal(owner.address)
            expect( await voting_escrow.ownerOf(ids[2])).to.equal(owner.address)
        });

        it("Should revert when indexes do not match veNFT Ids ", async function() {
            let wrong_indexes = [1,0,2]
            await expect(locker.connect(owner).transferNFTs(ids, wrong_indexes))
                .to.be.revertedWith("Wrong index slot")
            

        });

        it("Should revert when given mismatched array lengths ", async function() {
            let wrong_indexes = [1,0]
            await expect(locker.connect(owner).transferNFTs(ids, wrong_indexes))
                .to.be.revertedWith("Mismatched arrays")
            

        });

        it("Should revert when called by the wrong user", async function() {
            await expect(locker.connect(alice).transferNFTs(ids, [0,1,2]))
                .to.be.revertedWith("Only callable by owner")
            

        });
    });
    

});
