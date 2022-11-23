const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addresses } = require("../deployedAddresses.js")
const { helpers } = require("../testHelpers.js")


const ZERO_ADDRESS = ethers.constants.AddressZero;
const e18 = ethers.utils.parseEther("1.0"); //1 ether, used for 10^18 scale math
  
  
  describe("Unit tests: CollateralBook contract", function () {
    const SYNTH = 1; //collateral identifer enum
    const LYRA = 2;
    const threeMinInterest = 100000180
    const validOpenMargin = ethers.utils.parseEther("2.0");
    const validLiqMargin= ethers.utils.parseEther("1.1");
    const invalidLiqMargin= ethers.utils.parseEther("1.0");
    const validInterest = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
    const sUSDaddress = addresses.optimism.sUSD;
    const sETHaddress = addresses.optimism.sETH;
    const sBTCaddress = addresses.optimism.sBTC;
    const FAKE_ADDR = `0x57Ab1ec28D129707052df4dF418D58a2D46d5f51` //this is sUSD mainnet address, doesn't matter for the purpose of these tests.
    const sUSDCode = ethers.utils.formatBytes32String("sUSD");
    const sETHCode = ethers.utils.formatBytes32String("sETH");
    const sBTCCode = ethers.utils.formatBytes32String("sBTC");
    const sETHMinMargin = ethers.utils.parseEther("2.0");
    const sUSDMinMargin = ethers.utils.parseEther("1.8");
    const sETHLiqMargin = ethers.utils.parseEther("1.1");
    const sUSDLiqMargin = ethers.utils.parseEther("1.053");
    const sETHInterest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether") //realistic value
    const sUSDInterest = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
    let snapshotId;
    let setupTimeStamp;
    const provider = ethers.provider;

    before(async function () {
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
        collateralContract = await ethers.getContractFactory("CollateralBook");
        vaultContract = await ethers.getContractFactory("Vault_Synths");
        collateralBook = await collateralContract.deploy();
        vault = await vaultContract.deploy(FAKE_ADDR, FAKE_ADDR, collateralBook.address);
        await collateralBook.addVaultAddress(vault.address, SYNTH);
        await collateralBook.addCollateralType(sETHaddress, sETHCode, sETHMinMargin, sETHLiqMargin, sETHInterest, SYNTH, ZERO_ADDRESS);
        const tx = await collateralBook.addCollateralType(sUSDaddress, sUSDCode, sUSDMinMargin, sUSDLiqMargin, sUSDInterest, SYNTH, FAKE_ADDR);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        setupTimeStamp = block.timestamp;
    });

    beforeEach(async () => {
      snapshotId = await helpers.snapshot(provider);
      //console.log('Snapshotted at ', await provider.getBlockNumber());
    });
  
    afterEach(async () => {
      await helpers.revertChainSnapshot(provider, snapshotId);
      //console.log('Reset block heigh to ', await provider.getBlockNumber());
    });

    it("Should add and change collateral types correctly", async function(){

        //the adding call is done in the before block, we just verify the data is right.
        expect( await collateralBook.liquidityPoolOf(sETHCode)).to.equal(ZERO_ADDRESS);
        expect( await collateralBook.liquidityPoolOf(sUSDCode)).to.equal(FAKE_ADDR);
        let collateralProps = await collateralBook.collateralProps(sUSDaddress);
        expect(collateralProps[0]).to.equal(sUSDCode);
        expect(collateralProps[1]).to.equal(sUSDMinMargin);
        expect(collateralProps[2]).to.equal(sUSDLiqMargin);
        expect(collateralProps[3]).to.equal(sUSDInterest);
        expect(collateralProps[4]).to.equal(setupTimeStamp);
        expect(collateralProps[5]).to.equal(e18);
        expect(collateralProps[6]).to.equal(SYNTH);


        await collateralBook.queueCollateralChange(sUSDaddress, sBTCCode, sETHMinMargin, sETHLiqMargin, sETHInterest, SYNTH, sETHaddress);
        const timeToSkip = await collateralBook.CHANGE_COLLATERAL_DELAY();
        await helpers.timeSkip(timeToSkip.toNumber());
        await collateralBook.changeCollateralType();
        const collateralProps2 = await collateralBook.collateralProps(sUSDaddress);
        expect(collateralProps2[0]).to.equal(sBTCCode);
        expect(collateralProps2[1]).to.equal(sETHMinMargin);
        expect(collateralProps2[2]).to.equal(sETHLiqMargin);
        expect(collateralProps2[3]).to.equal(sETHInterest);
        //timesteps are 180s each so time leftover past this won't be updated
        let timeAdvanced = timeToSkip.toNumber() - (timeToSkip.toNumber() % 180)
        expect(collateralProps2[4]).to.equal(setupTimeStamp + timeAdvanced);
        //calculate  what the virtualPrice should now be
        let cycles = Math.floor(timeToSkip/180);
        let manualVPcalc = e18;
        for (let i = 0; i < cycles; i++){
          manualVPcalc = manualVPcalc.mul(sUSDInterest);
          manualVPcalc = manualVPcalc.div(e18);
        }
        expect(collateralProps2[5]).to.equal(manualVPcalc);
        expect(collateralProps2[6]).to.equal(SYNTH);
        //we changed the code so the old code should have been reset and new one should now be set.
        expect( await collateralBook.liquidityPoolOf(sUSDCode)).to.equal(ZERO_ADDRESS);
        expect( await collateralBook.liquidityPoolOf(sBTCCode)).to.equal(sETHaddress);
    })

    it("Should only allow owner to call functions", async function () {
      await expect(collateralBook.connect(addr2).addCollateralType(sBTCaddress, sBTCCode, validOpenMargin, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.revertedWith("Caller is not an admin");
      await expect(collateralBook.connect(addr2).changeCollateralType()).to.be.revertedWith("Caller is not an admin");
      await expect(collateralBook.connect(addr2).queueCollateralChange(sETHaddress, sETHCode, validOpenMargin, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.revertedWith("Caller is not an admin");
      await expect(collateralBook.connect(addr2).pauseCollateralType(sETHaddress, sETHCode)).to.be.revertedWith("Caller is not an admin");
      await expect(collateralBook.connect(addr2).unpauseCollateralType(sETHaddress, sETHCode)).to.be.revertedWith("Caller is not an admin");
      await expect(collateralBook.connect(addr2).addVaultAddress(sETHaddress, SYNTH)).to.be.revertedWith("Caller is not an admin");

    });
    it("Should add a new valid collateral token", async function () {
      expect(await collateralBook.collateralValid(sBTCaddress)).to.equal(false);
      await collateralBook.addCollateralType(sBTCaddress, sBTCCode, validOpenMargin, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS);
      expect(await collateralBook.collateralValid(sBTCaddress)).to.equal(true);
    });
    it("Should fail to create pre-existing collateral token", async function () {
      await expect(collateralBook.addCollateralType(sETHaddress, sETHCode, validOpenMargin, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.revertedWith("Collateral already exists");
    });

    it("Should be able to pause and unpause an existing collateral token", async function () {
      expect(await collateralBook.collateralValid(sETHaddress)).to.equal(true);
      expect(await collateralBook.collateralPaused(sETHaddress)).to.equal(false);
      await collateralBook.pauseCollateralType(sETHaddress, sETHCode);
      expect(await collateralBook.collateralValid(sETHaddress)).to.equal(false);
      expect(await collateralBook.collateralPaused(sETHaddress)).to.equal(true);
      await collateralBook.unpauseCollateralType(sETHaddress, sETHCode);
      expect(await collateralBook.collateralValid(sETHaddress)).to.equal(true);
      expect(await collateralBook.collateralPaused(sETHaddress)).to.equal(false);
    });

    it("Should fail to call onlyVault functions prior to setting related vault address", async function (){
        collateralContract2 = await ethers.getContractFactory("CollateralBook");
        collateralBook2 = await collateralContract.deploy();
        expect(await collateralBook2.vaults(SYNTH)).to.equal(ZERO_ADDRESS);
        //const liq_return = ethers.utils.parseEther("0.95");
        await expect(collateralBook2.addCollateralType(sETHaddress, sETHCode, sETHMinMargin, sETHLiqMargin, sETHInterest, SYNTH, ZERO_ADDRESS)).to.be.revertedWith("Vault not deployed yet");
    });

    it("Should fail to unpause when conditions aren't met", async function () {
      expect(await collateralBook.collateralValid(sETHaddress)).to.equal(true);
      expect(await collateralBook.collateralPaused(sETHaddress)).to.equal(false);
      await expect(collateralBook.unpauseCollateralType(sETHaddress, sBTCCode)).to.be.revertedWith("Unsupported collateral or not Paused");
      expect(await collateralBook.collateralValid(sETHaddress)).to.equal(true);
      expect(await collateralBook.collateralPaused(sETHaddress)).to.equal(false);

      expect(await collateralBook.collateralPaused(sBTCaddress)).to.equal(false);
      await expect(collateralBook.pauseCollateralType(sBTCaddress, sBTCCode)).to.be.revertedWith("Unsupported collateral!");
      expect(await collateralBook.collateralValid(sBTCaddress)).to.equal(false);
      expect(await collateralBook.collateralPaused(sBTCaddress)).to.equal(false);
      await expect(collateralBook.pauseCollateralType(ZERO_ADDRESS, sBTCCode)).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail to pause when conditions aren't met", async function () {
      expect(await collateralBook.collateralValid(sETHaddress)).to.equal(true);
      expect(await collateralBook.collateralPaused(sETHaddress)).to.equal(false);
      await expect(collateralBook.pauseCollateralType(sETHaddress, sBTCCode)).to.be.revertedWith("Mismatched data");
      expect(await collateralBook.collateralValid(sETHaddress)).to.equal(true);
      expect(await collateralBook.collateralPaused(sETHaddress)).to.equal(false);

      expect(await collateralBook.collateralPaused(sBTCaddress)).to.equal(false);
      await expect(collateralBook.pauseCollateralType(sBTCaddress, sBTCCode)).to.be.revertedWith("Unsupported collateral!");
      expect(await collateralBook.collateralValid(sBTCaddress)).to.equal(false);
      expect(await collateralBook.collateralPaused(sBTCaddress)).to.equal(false);

      await expect(collateralBook.pauseCollateralType(ZERO_ADDRESS, sBTCCode)).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail to set an assetType's vault more than once", async function () {
      expect(await collateralBook.vaults(SYNTH)).to.equal(vault.address);
      await expect(collateralBook.addVaultAddress(vault.address, SYNTH)).to.be.revertedWith("Asset type already has vault");
    });

    it("Should fail to create with incorrect params", async function () {
      await expect(collateralBook.addCollateralType(ZERO_ADDRESS, sETHCode, validOpenMargin, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.reverted;
      await expect(collateralBook.addCollateralType(sBTCaddress, sETHCode, 10, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.reverted;
      await expect(collateralBook.addCollateralType(sBTCaddress, sETHCode, validOpenMargin, 0, validInterest, SYNTH, ZERO_ADDRESS)).to.be.reverted;
      await expect(collateralBook.addCollateralType(sBTCaddress, sBTCCode, validOpenMargin, invalidLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.revertedWith("Liquidation ratio too low");

    });

    it("Should fail to modify nonexistent collateral token", async function () {
      await expect(collateralBook.queueCollateralChange(sBTCaddress, sETHCode, validOpenMargin, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail to trigger a collateral change before deadline or queuing", async function () {
      await expect(collateralBook.changeCollateralType()).to.be.revertedWith("Uninitialized collateral change");
      await collateralBook.queueCollateralChange(sUSDaddress, sBTCCode, sETHMinMargin, sETHLiqMargin, sETHInterest, SYNTH, sETHaddress);
      const timeToSkip = await collateralBook.CHANGE_COLLATERAL_DELAY();
      await helpers.timeSkip(timeToSkip.toNumber() - 10);
      await expect(collateralBook.changeCollateralType()).to.be.revertedWith("Not enough time passed");
    });

    it("Should fail to modify with incorrect params", async function () {
      await expect(collateralBook.queueCollateralChange(ZERO_ADDRESS, sETHCode, validOpenMargin, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.revertedWith("Unsupported collateral!");
      await expect(collateralBook.queueCollateralChange(sETHaddress, sETHCode, 10, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.reverted;
      await expect(collateralBook.queueCollateralChange(sETHaddress, sETHCode, validOpenMargin, 0, validInterest, SYNTH, ZERO_ADDRESS)).to.be.reverted;
      await expect(collateralBook.queueCollateralChange(sBTCaddress, sETHCode, validOpenMargin, validLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.reverted;
      await expect(collateralBook.queueCollateralChange(sETHaddress, sETHCode, validOpenMargin, invalidLiqMargin, validInterest, SYNTH, ZERO_ADDRESS)).to.be.revertedWith("Liquidation ratio too low");
    });

    it("Should allow multiple vaults to be added", async function () {
      expect(await collateralBook.vaults(SYNTH)).to.equal(vault.address);

      vault2 = await vaultContract.deploy(FAKE_ADDR, FAKE_ADDR, collateralBook.address);
      await collateralBook.addVaultAddress(vault2.address, LYRA)
      expect(await collateralBook.vaults(SYNTH)).to.equal(vault.address);
      expect(await collateralBook.vaults(LYRA)).to.equal(vault2.address);

    });
    

    describe("updateVirtualPriceSlowly", function () {
      const interestBase = 100000000;
      const threeMinInterest = 100000180; //alias as this test was originally in the Vault and got moved
      beforeEach(async function () {
      });
  
      it("Should allow anyone to call it", async function () {
        //call with addr2 here
        await helpers.timeSkip(360); //6 minutes
        await collateralBook.connect(addr2).updateVirtualPriceSlowly(sETHaddress, 1 ); 
      });
  
      it("Should fail with more cycles that needed", async function () {
        //set cycles bigger than timedelta here
        await expect(collateralBook.updateVirtualPriceSlowly(sETHaddress, e18)).to.be.revertedWith("Cycle count too high"); 
      });
  
      it("Should fail with nonexistent collateral", async function () {
        //set cycles bigger than timedelta here
        await expect(collateralBook.updateVirtualPriceSlowly(sBTCaddress, 1 )).to.be.revertedWith("Unsupported collateral!"); 
      });
  
      it("Should update virtual price correctly.", async function () {
        //we call the function several times and verify the virtualPrice updates as we expect.
        const virtualPrice0 = await collateralBook.viewVirtualPriceforAsset(sETHaddress);
        const updateTime0 = await collateralBook.viewLastUpdateTimeforAsset(sETHaddress);
        await helpers.timeSkip(183); //3 minutes and 3s to check timestamps only update in multiples of 180
        await collateralBook.connect(addr2).updateVirtualPriceSlowly(sETHaddress, 1 ); 
        const virtualPrice1 = await collateralBook.viewVirtualPriceforAsset(sETHaddress);
        const updateTime1 = await collateralBook.viewLastUpdateTimeforAsset(sETHaddress);
        const manualVPcalc = ethers.BigNumber.from(virtualPrice0).mul(threeMinInterest).div(interestBase);
        expect(virtualPrice1).to.equal(manualVPcalc);
        expect(updateTime1).to.equal(updateTime0.add(180))
        const loopNo = 43200; //12 hours in seconds
        await helpers.timeSkip(loopNo);
        let cycles = Math.floor(loopNo/180);
        let multiplier = e18;
        await collateralBook.connect(addr2).updateVirtualPriceSlowly(sETHaddress, cycles); 
        const virtualPrice2 = await collateralBook.viewVirtualPriceforAsset(sETHaddress);
        const updateTime2 = await collateralBook.viewLastUpdateTimeforAsset(sETHaddress);
        for (let i = 0; i < cycles; i++){
          multiplier = multiplier.mul(threeMinInterest);
          multiplier = multiplier.div(interestBase);
        }
        //multiplier = Math.round(multiplier);
        const manualVPcalc2 = virtualPrice1.mul(multiplier).div(e18);
        expect(virtualPrice2).to.equal(manualVPcalc2);
        expect(updateTime2).to.equal(updateTime1.add(43200))
        //repeated calls should fail.
        await expect(collateralBook.connect(addr2).updateVirtualPriceSlowly(sETHaddress, cycles)).to.be.revertedWith("Cycle count too high");
      });
      
      it("Should update virtual price correctly over a long period of time", async function () {
        //we call the function several times and verify the virtualPrice updates as we expect.
        //Due to limitations of JS handling very large integers it is not possible to write a 
        //generic solution that maintains complete precision of caculations over a very long period 
        //stepsize of 240 is safe, bigger is not tested, 7000 appears to work. (240 step = 12hr update step)
        const virtualPrice0 = await collateralBook.viewVirtualPriceforAsset(sETHaddress);
        const loopNo = 2592000; //30 days in seconds
        await helpers.timeSkip(loopNo);
        let cycles = Math.floor(loopNo/180);
        let multiplier = e18;
        let stepBase = ethers.BigNumber.from("1");
        let stepSize = 240;
  
        for (let i = 0; i < stepSize; i++){
          multiplier = multiplier.mul(threeMinInterest);
          stepBase = stepBase.mul(interestBase);
        }
    
        
        for(let i = stepSize; i < cycles; i = i+stepSize){
          const virtualPrice1 = await collateralBook.viewVirtualPriceforAsset(sETHaddress);
          await collateralBook.connect(addr2).updateVirtualPriceSlowly(sETHaddress, stepSize);
          const virtualPrice2 = await collateralBook.viewVirtualPriceforAsset(sETHaddress);
          const manualVPcalc2 = virtualPrice1.mul(multiplier).div(stepBase).div(e18);
          //we check the virtualPrice is within 0.01% of expected value to account for rounding errors
          expect(virtualPrice2).to.be.closeTo(manualVPcalc2, manualVPcalc2.div(10000));
          
        }
        
        
      });
         
    
      
    });
  
    
  });


  
