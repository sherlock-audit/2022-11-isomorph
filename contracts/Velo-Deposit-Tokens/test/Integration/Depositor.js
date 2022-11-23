const { expect } = require("chai")
const { ethers } = require("hardhat")
const { helpers } = require("../helpers/testHelpers.js")
const { ABIs } = require("../helpers/abi.js")
const { addresses } = require("../helpers/deployedAddresses.js")

async function impersonateForToken(provider, receiver, ERC20, donerAddress, amount) {
    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [donerAddress], 
    });
    const signer = await provider.getSigner(donerAddress);
    await ERC20.connect(signer).transfer(receiver.address, amount);
    await network.provider.request({
      method: "hardhat_stopImpersonatingAccount",
      params: [donerAddress] 
    });
    
  }

describe("Integration OP Mainnet: Depositor contract", function () {
    const provider = ethers.provider;
    const stable = true;
    tokenA = addresses.optimism.USDC //USDC
    tokenB = addresses.optimism.sUSD //sUSD
    Velo = addresses.optimism.VELO
    AMMToken_address = addresses.optimism.AMMToken
    gauge_address = addresses.optimism.Gauge
    router_address = addresses.optimism.Router
    pricefeed_address = addresses.optimism.Chainlink_SUSD_Feed 
    AMMToken_donor = addresses.optimism.AMMToken_Donor
    const ZERO_ADDRESS = ethers.constants.AddressZero

    const AMMToken = new ethers.Contract(AMMToken_address, ABIs.ERC20, provider)
    const gauge = new ethers.Contract(gauge_address, ABIs.Gauge, provider)

    before(async function () {
        this.timeout(100000);
        
        [owner, alice, bob, ...addrs] = await ethers.getSigners()
        Depositor = await ethers.getContractFactory("Depositor")
        DepositReceipt = await ethers.getContractFactory("DepositReceipt_USDC")

        //If this section is uncommented the tests run in isolation but fail when run as part of the full suite
        //determine what dark magic is causing this.
        
        /*
        depositReceipt = await DepositReceipt.deploy(
            "Deposit_Receipt",
            "DR",
            router_address,
            tokenA,
            tokenB, 
            true,
            pricefeed_address
            )
        */ 
    

        depositor = await Depositor.connect(owner).deploy(
            depositReceipt.address,
            AMMToken.address,
            gauge.address,
            )
        
        depositReceipt.connect(owner).addMinter(depositor.address)
        
        //hijack some AMMtokens for our user to test with here
        amount = await AMMToken.balanceOf(AMMToken_donor)
        //verify we're not looking at the wrong account, makes debugging quicker
        expect(amount).to.be.greaterThan(0)
        await impersonateForToken(provider, owner, AMMToken, AMMToken_donor, amount)

    })

    beforeEach(async () => {
        snapshotId = await helpers.snapshot(provider)
        //console.log('Snapshotted at ', await provider.getBlockNumber())
    });
    
    afterEach(async () => {
        await helpers.revertChainSnapshot(provider, snapshotId)
        //console.log('Reset block heigh to ', await provider.getBlockNumber())
    });
    describe("Constructor", function (){
        it("Should set up the right addresses", async function (){
            expect( await depositor.depositReceipt() ).to.equal(depositReceipt.address)
            expect( await depositor.gauge() ).to.equal(gauge.address)
            expect( await depositor.AMMToken() ).to.equal(AMMToken.address)
            
        });
       
      });

    describe("depositToGauge", function (){
        it("Should deposit to gauge with right user call", async function (){
            this.timeout(100000);
            const amount = ethers.utils.parseEther('0.00002')
            before_gauge_tokens = await AMMToken.balanceOf(gauge.address)
            before_owner_tokens = await AMMToken.balanceOf(owner.address)
            

            await AMMToken.connect(owner).approve(depositor.address, amount)
            
            await depositor.connect(owner).depositToGauge(amount)
            let nft_id = 1
            //after transaction checks
            after_gauge_tokens = await AMMToken.balanceOf(gauge.address)
            after_owner_tokens = await AMMToken.balanceOf(owner.address)
            after_receipt_owner = await depositReceipt.ownerOf(nft_id)

            expect(after_gauge_tokens).to.equal(before_gauge_tokens.add(amount))
            expect(after_owner_tokens).to.equal(before_owner_tokens.sub(amount))
            expect(after_receipt_owner).to.equal(owner.address)
            expect( await depositReceipt.relatedDepositor(nft_id)).to.equal(depositor.address)

            
        });

        it("Should fail if AMMToken lacks approval", async function (){
            const amount = ethers.utils.parseEther('0.00002')
            //the AMM tokens are not strict ERC20s so just overflow rather than the insufficient allowance error
            await expect(depositor.connect(owner).depositToGauge(amount)).to.be.revertedWithPanic(0x11);
            
        });

        it("Should fail if called by wrong user ", async function (){
            const amount = ethers.utils.parseEther('0.00002')
            await expect(depositor.connect(bob).depositToGauge(amount)).to.be.revertedWith("Ownable: caller is not the owner")
            
        });
        
    });

    describe("withdrawFromGauge", function (){

        
        it("Should withdraw from gauge with right user call", async function (){
            //setup deposit first
            const amount = ethers.utils.parseEther('0.00002') 
            const NFT_id = 1;     
            await AMMToken.connect(owner).approve(depositor.address, amount)
            await depositor.connect(owner).depositToGauge(amount)
            //need to set up new rewards or seed gauge with some?
            rewards_address = ZERO_ADDRESS

            before_receipt_owner = await depositReceipt.ownerOf(NFT_id)
            expect(before_receipt_owner).to.equal(owner.address)
            before_owner_tokens = await AMMToken.balanceOf(owner.address)
            await depositReceipt.approve(depositor.address, NFT_id)
            await depositor.connect(owner).withdrawFromGauge(NFT_id, [rewards_address])

            //after transaction checks
            //we burned the deposit receipt NFT so it shouldn't exist now
            await expect(depositReceipt.ownerOf(NFT_id)).to.be.revertedWith('ERC721: invalid token ID')
            
            after_owner_tokens = await AMMToken.balanceOf(owner.address)
            expect(after_owner_tokens).to.equal(before_owner_tokens.add(amount))
            
        });

        it("Should fail if depositing user now lacks ownership of the depositReceipt", async function (){
             const NFT_id = 1;
             //setup deposit first
             const amount = ethers.utils.parseEther('0.00001')      
             await AMMToken.connect(owner).approve(depositor.address, amount)
             await depositor.connect(owner).depositToGauge(amount)
             rewards_address = ZERO_ADDRESS
             
             await depositReceipt["safeTransferFrom(address,address,uint256)"](owner.address, alice.address, NFT_id)
             before_receipt_owner = await depositReceipt.ownerOf(NFT_id)
             expect(before_receipt_owner).to.equal(alice.address)
            
             
             await expect(depositor.connect(owner).withdrawFromGauge(NFT_id, [rewards_address])).to.be.revertedWith("ERC721: caller is not token owner or approved")
 
        });

        it("Should fail if called by wrong user ", async function (){
             const NFT_id = 1;
             //setup deposit first
             const amount = ethers.utils.parseEther('0.00001')      
             await AMMToken.connect(owner).approve(depositor.address, amount)
             await depositor.connect(owner).depositToGauge(amount)
             rewards_address = ZERO_ADDRESS

            await expect(depositor.connect(bob).withdrawFromGauge(NFT_id, [rewards_address])).to.be.revertedWith("ERC721: caller is not token owner or approved")
            
        });

        
        
    });

    describe("claimRewards", function (){

        it("Should withdraw rewards from gauge with right user call", async function (){
            this.timeout(100000);
            const NFT_id = 1;
             //setup deposit first
             const amount = ethers.utils.parseEther('0.00001')      
             await AMMToken.connect(owner).approve(depositor.address, amount.mul(2))
             await depositor.connect(owner).depositToGauge(amount)
            //set up already deployed rewards token contract
            velo_address = addresses.optimism.VELO

            const abi = [
                "function balanceOf(address account) view returns(uint256)"
            ]
            velo = new ethers.Contract(velo_address, abi, provider);

            before_owner_rewards = await velo.connect(owner).balanceOf(owner.address)
            expect(before_owner_rewards).to.equal(0)
            before_depositor_rewards = await velo.balanceOf(depositor.address)
            expect(before_depositor_rewards).to.equal(0)

            helpers.timeSkip(1000)
            await depositor.connect(owner).depositToGauge(amount)
            let expected_rewards = await depositor.viewPendingRewards(velo.address)
            await depositor.connect(owner).claimRewards([velo.address])

            
            after_owner_rewards = await velo.balanceOf(owner.address)
            let error = after_owner_rewards.div(33) //margin of error 3% as earned is only an estimate
            expect(after_owner_rewards).to.be.closeTo(expected_rewards,error)
            //no rewards should be left in the depositor
            after_depositor_rewards = await velo.balanceOf(depositor.address)
            expect(after_depositor_rewards).to.equal(0)
            
        });

        it("Should fail if called with empty data ", async function (){
            await expect(depositor.connect(owner).claimRewards([])).to.be.revertedWith("Empty tokens array")
            
        });

        it("Should fail if called by wrong user ", async function (){
            rewards_address = addresses.optimism.VELO
            await expect(depositor.connect(bob).claimRewards([rewards_address])).to.be.revertedWith("Ownable: caller is not the owner")
            
        });

        it("Should still have pending rewards after withdrawal from gauge", async function (){
            this.timeout(100000);
            const NFT_id = 1;
             //setup deposit first
             const amount = ethers.utils.parseEther('0.00001')      
             await AMMToken.connect(owner).approve(depositor.address, amount.mul(2))
             await depositor.connect(owner).depositToGauge(amount)
            //set up already deployed rewards token contract
            velo_address = addresses.optimism.VELO
            velo = new ethers.Contract(velo_address, ABIs.ERC20, provider);

            //state checks prior to actions
            before_owner_rewards = await velo.connect(owner).balanceOf(owner.address)
            expect(before_owner_rewards).to.equal(0)
            before_depositor_rewards = await velo.balanceOf(depositor.address)
            expect(before_depositor_rewards).to.equal(0)

            //skip time to accumulate rewards
            helpers.timeSkip(1000)
            //trigger rewards to accumulate by interacting with gauge
            await depositor.connect(owner).depositToGauge(amount)
            //check accumulated rewards
            let expected_rewards = await depositor.viewPendingRewards(velo.address)
            let gauge_rewards = await gauge.earned(velo.address, depositor.address)
            expect(expected_rewards).to.equal(gauge_rewards)            

            //withdraw all funds from depositor
            await depositReceipt.approve(depositor.address, NFT_id)
            await depositor.connect(owner).withdrawFromGauge(NFT_id, [])
            //assert claimable rewards haven't changed due to withdraw
            let expected_rewards_after = await depositor.viewPendingRewards(velo.address)
            let gauge_rewards_after = await gauge.earned(velo.address, depositor.address)

            expect(expected_rewards_after).to.be.greaterThan(expected_rewards)
            expect(gauge_rewards_after).to.be.greaterThan(gauge_rewards)

            //claim rewards

            await depositor.connect(owner).claimRewards([velo.address])
        
            after_owner_rewards = await velo.balanceOf(owner.address)
            let error = after_owner_rewards.div(33) //margin of error 3% as earned is only an estimate
            expect(after_owner_rewards).to.be.closeTo(expected_rewards_after,error)
            //no rewards should be claimable in gauge for depositor owner
            let leftover_rewards = await depositor.viewPendingRewards(velo.address)
            expect(leftover_rewards).to.equal(0)
        });

        
        
    });

    describe("viewPendingRewards", function (){

        it("Should return pending rewards of only reward eligible tokens", async function (){
            this.timeout(100000);
            const NFT_id = 1;
             //setup deposit first
             const amount = ethers.utils.parseEther('0.00001')      
             await AMMToken.connect(owner).approve(depositor.address, amount.mul(2))
             await depositor.connect(owner).depositToGauge(amount)
            //set up already deployed rewards token contract
            velo_address = addresses.optimism.VELO

            
            velo = new ethers.Contract(velo_address, ABIs.ERC20, provider);

            before_owner_rewards = await velo.connect(owner).balanceOf(owner.address)
            expect(before_owner_rewards).to.equal(0)
            before_depositor_rewards = await velo.balanceOf(depositor.address)
            expect(before_depositor_rewards).to.equal(0)

            helpers.timeSkip(1000)
            await depositor.connect(owner).depositToGauge(amount)
            let expected_rewards = await depositor.viewPendingRewards(velo.address)
            let gauge_rewards = await gauge.earned(velo.address, depositor.address)
            expect(expected_rewards).to.equal(gauge_rewards)            

            //test unknown token address
            let expected_rewards_unknown = await depositor.viewPendingRewards(bob.address)
            let gauge_rewards_unknown = await gauge.earned(bob.address, owner.address)
            expect(expected_rewards_unknown).to.equal(0)
            expect(expected_rewards_unknown).to.equal(gauge_rewards_unknown)

            
            
        });

        



    });
})
