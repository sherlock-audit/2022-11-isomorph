const { expect } = require("chai")
const { ethers } = require("hardhat")
const { helpers } = require("../helpers/testHelpers.js")

describe("Unit tests: Templater contract", function () {
    const provider = ethers.provider;
    const ZERO_ADDRESS = ethers.constants.AddressZero;
    

    before(async function () {
        
        [owner, alice, bob, ...addrs] = await ethers.getSigners()
        Templater = await ethers.getContractFactory("Templater")
        TESTERC20Token = await ethers.getContractFactory("TESTERC20Token")
        PriceOracle = await ethers.getContractFactory("TESTAggregatorV3")
        TESTVoter = await ethers.getContractFactory("TESTVoter")
        TESTGauge = await ethers.getContractFactory("TESTGauge")

        //one token must mimic USDC to bypass checks
        tokenA = await TESTERC20Token.deploy("TokenA", "USDC")
        tokenB = await TESTERC20Token.deploy("TokenB", "TB")
        priceOracle = await PriceOracle.deploy(110000000)
        gauge = await TESTGauge.deploy(alice.address)
        voter = await TESTVoter.deploy(gauge.address)

        templater = await Templater.deploy(
            tokenA.address,
            tokenB.address,
            true,
            alice.address,
            voter.address,
            bob.address,
            priceOracle.address)


    })

    beforeEach(async () => {
        snapshotId = await helpers.snapshot(provider)
        //console.log('Snapshotted at ', await provider.getBlockNumber())
    });
    
    afterEach(async () => {
        await helpers.revertChainSnapshot(provider, snapshotId)
        //console.log('Reset block heigh to ', await provider.getBlockNumber())
    });

    describe("constructor", function (){
        it("Should set up strings and names right", async function (){
            tokenA_symbol = await tokenA.symbol()
            tokenB_symbol = await tokenB.symbol()
            let name = "Deposit-Receipt-StableV1 AMM - " + tokenA_symbol + "/" + tokenB_symbol
            let symbol = "Receipt-sAMM-" + tokenA_symbol + "/" + tokenB_symbol

            deposit_receipt_address = await templater.depositReceipt()
            const DR_abi = ["function name () external view returns(string)",
                        "function symbol() external view returns(string)"]
            deposit_receipt = new ethers.Contract(deposit_receipt_address, DR_abi, provider);
            expect(await deposit_receipt.name()).to.equal(name)
            expect(await deposit_receipt.symbol()).to.equal(symbol)

            //now we check the volatile pairs are named right

            templater_2 = await Templater.deploy(
                tokenA.address,
                tokenB.address,
                false,
                alice.address,
                voter.address,
                bob.address,
                priceOracle.address)

            name = "Deposit-Receipt-VolatileV1 AMM - " + tokenA_symbol + "/" + tokenB_symbol
            symbol = "Receipt-vAMM-" + tokenA_symbol + "/" + tokenB_symbol
    
            v_deposit_receipt_address = await templater_2.depositReceipt()
            v_deposit_receipt = new ethers.Contract(v_deposit_receipt_address, DR_abi, provider);
            expect(await v_deposit_receipt.name()).to.equal(name)
            expect(await v_deposit_receipt.symbol()).to.equal(symbol)
    
            
        });

        it("Should reject any zero address inputs", async function (){
            
            await expect(Templater.deploy(
                ZERO_ADDRESS,
                tokenB.address,
                false,
                alice.address,
                voter.address,
                bob.address,
                priceOracle.address)).to.be.revertedWith("Zero address used")

            await expect(Templater.deploy(
                tokenA.address,
                ZERO_ADDRESS,
                false,
                alice.address,
                voter.address,
                bob.address,
                priceOracle.address)).to.be.revertedWith("Zero address used")

            await expect(Templater.deploy(
                tokenA.address,
                tokenB.address,
                false,
                ZERO_ADDRESS,
                voter.address,
                bob.address,
                priceOracle.address)).to.be.revertedWith("Zero address used")
            
            await expect(Templater.deploy(
                tokenA.address,
                tokenB.address,
                false,
                alice.address,
                ZERO_ADDRESS,
                bob.address,
                priceOracle.address)).to.be.revertedWith("Zero address used")

            await expect(Templater.deploy(
                tokenA.address,
                tokenB.address,
                false,
                alice.address,
                voter.address,
                ZERO_ADDRESS,
                priceOracle.address)).to.be.revertedWith("Zero address used")

            await expect(Templater.deploy(
                tokenA.address,
                tokenB.address,
                false,
                alice.address,
                voter.address,
                bob.address,
                ZERO_ADDRESS)).to.be.revertedWith("Zero address used")
    
        });
        
      });

    describe("makeNewDepositor", function (){
        it("Should allow anyone to set up a new Depositer", async function (){
            let tx_1 = await templater.connect(owner).makeNewDepositor()
            let new_depositor = await templater.UserToDepositor(owner.address)
            await expect(tx_1).to.emit(templater, "newDepositorMade").withArgs(owner.address, new_depositor)

            tx_2 = await templater.connect(alice).makeNewDepositor()
            new_depositor = await templater.UserToDepositor(alice.address)
            await expect(tx_2).to.emit(templater, "newDepositorMade").withArgs(alice.address, new_depositor)
        });
        it("Should revert if called twice by the same user", async function (){
            await templater.connect(alice).makeNewDepositor()
            await expect(templater.connect(alice).makeNewDepositor()).to.be.revertedWith("User already has Depositor")
            
        });
      });
})
