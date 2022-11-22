// We import Chai to use its asserting functions here.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addresses } = require("../deployedAddresses.js")
const { ABIs } = require("../abi.js")
const { helpers } = require("../testHelpers.js")


async function impersonateForToken(provider, receiver, ERC20, donerAddress, amount) {
  let tokens_before = await ERC20.balanceOf(receiver.address)
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
  let tokens_after = await ERC20.balanceOf(receiver.address)
  expect(tokens_after).to.equal(tokens_before.add(amount))
  
}

async function suspend_synth(provider, synth) {
  //owner is capable of resume and suspend Synths, as verified using accessControl function on etherscan.
  const Synthetix_owner = addresses.optimism.Synth_Owner;
  const system_addr = addresses.optimism.System;
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [Synthetix_owner] 
  });
  const signer = await provider.getSigner(Synthetix_owner);
  const systemStatus = new ethers.Contract(system_addr, ABIs.SynthSystem, provider);
  await systemStatus.connect(signer).suspendSynth(synth,0);  
  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [Synthetix_owner]
  });
}

async function resume_synth(provider, synth) {
  const Synthetix_owner = addresses.optimism.Synth_Owner;
  const system_addr = addresses.optimism.System;
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [Synthetix_owner], 
  });
  const signer = await provider.getSigner(Synthetix_owner);
  const systemStatus = new ethers.Contract(system_addr, ABIs.SynthSystem, provider);
  await systemStatus.connect(signer).resumeSynths([synth]);
  await network.provider.request({
    method: "hardhat_stopImpersonatingAccount",
    params: [Synthetix_owner], 
  });
}

function timeSkipRequired(totalInterest, threeMinInterest){
  //helper function to automatically determine the amount of time skips needed to achieve the required interest owed
  let decimalThreeMinInterest = threeMinInterest /100000000;
  let powerNeeded = (Math.log(totalInterest) / Math.log(decimalThreeMinInterest));
  let timeSkipinSecs = powerNeeded*180;
  return Math.floor(timeSkipinSecs);
}

async function cycleVirtualPrice(steps, collateral) {
    steps = Math.floor(steps);
    helpers.timeSkip(steps);
    cycleCount = 240; //12 hours of of data updated at each call
    stepCount = Math.floor(steps / (180*cycleCount));
    if(steps / (180*cycleCount) - stepCount > 0.95){
      console.log("***Virtual Price update close to boundary, may cause inaccurate figures later***")
    }
    for(let i = 0; i < stepCount; i++){
      await collateralBook.updateVirtualPriceSlowly(collateral.address, cycleCount);
      
    }
    //final loop with leftover time
    leftoverCycles  = Math.floor((steps - stepCount*cycleCount*180)/180)
    await collateralBook.updateVirtualPriceSlowly(collateral.address, leftoverCycles);
}


describe("Integration tests: Vault Synths contract", function () {
  

  let owner; //0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
  let addr1; //0x70997970c51812dc3a010c7d01b50e0d17dc79c8
  let addr2; //0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc
  let addrs;
  let signer;
  let FakeAddr; //used when we need an unrelated address
  const ZERO_ADDRESS = ethers.constants.AddressZero;
  
  
  const testCode = ethers.utils.formatBytes32String("test");
  const sUSDCode = ethers.utils.formatBytes32String("sUSD");
  const sETHCode = ethers.utils.formatBytes32String("sETH");
  const sBTCCode = ethers.utils.formatBytes32String("sBTC");
  const MINTER = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));

  const sUSDaddr = addresses.optimism.sUSD;
  const sETHaddr = addresses.optimism.sETH;
  const sBTCaddr = addresses.optimism.sBTC;

  const sUSDDoner = addresses.optimism.sUSD_Doner
  const SETHDoner = addresses.optimism.sETH_Doner
  
  const provider = ethers.provider;

  const sUSD = new ethers.Contract(sUSDaddr, ABIs.ERC20, provider);
  const sETH = new ethers.Contract(sETHaddr, ABIs.ERC20, provider);
  const sBTC = new ethers.Contract(sBTCaddr, ABIs.ERC20, provider);

  //consts used for maths or the liquidation system
  const colQuantity = ethers.utils.parseEther('2.77');
  const liquidatorFee = 0.05; //5%
  const liquidatorFeeBN = ethers.utils.parseEther('0.05'); //5%
  const sETHtosUSDfee = 0.003; //0.3%
  let loanOpenfee = ethers.utils.parseEther('0.01'); //1%
  const loanSizeInisoUSD = 10000000;
  const PartialloanSizeInisoUSD = 7000000;
  //const BASE_FEE = ethers.utils.parseEther('1'); //minimum loan open fee, used to prevent microloans
  const e18 = ethers.utils.parseEther('1');
  const zero = ethers.utils.parseEther('0');
  const base = ethers.utils.parseEther('1'); // 1eth
  const threeMinInterest = 100000180 //119710969;
  let liq_return //grabs LIQUIDATION_RETURN constant after setting up vault contract.
  const TIME_DELAY = 3 //3 seconds to avoid Synthetix price feeds becoming stale with the normal 3 day value.
  
  //identifiers for collateral settings
  const SYNTH = 0;
  const LYRA = 1;

  let snapshotId;


  // `beforeEach` will run before each test, re-deploying the contract every
  // time. It receives a callback, which can be async.
  before(async function () {
        // Get the ContractFactory and Signers here 
        this.timeout(1000000);
        const provider = ethers.provider;
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
        FakeAddr = addrs[0].address;
        console.log('Block Index at start ', await provider.getBlockNumber());
        const Synthetix_owner = addresses.optimism.Synth_Owner;
        //console.log("PROVIDER ", provider);  
        let donerAmount = ethers.utils.parseEther('500000'); //$1million sUSD;
        
        //borrow collateral tokens from doner addresses 
        impersonateForToken(provider, owner, sUSD, sUSDDoner, donerAmount)

        //give Synth controller SC some ETH so we can force it to make calls later
        deathSeedContract = await ethers.getContractFactory("TESTdeathSeed");
        deathSeed2 = await deathSeedContract.deploy()
        deathSeed2.terminate(Synthetix_owner, {"value" : e18}); //self destruct giving ETH to SC without receive.
        
        contract = await ethers.getContractFactory("Vault_Synths");
        isoUSDcontract = await ethers.getContractFactory("isoUSDToken");

        collateralContract = await ethers.getContractFactory("TESTCollateralBook");
       

        isoUSD = await isoUSDcontract.deploy();
        

        treasury = addrs[1]
        collateralBook = await collateralContract.deploy(); 
        vault = await contract.deploy(isoUSD.address, treasury.address, collateralBook.address);
        await collateralBook.addVaultAddress(vault.address, SYNTH);

        const amountIn= ethers.utils.parseEther('1000');
        await sUSD.connect(owner).transfer(addr1.address, amountIn); //10**19 or 10 eth
        await isoUSD.proposeAddRole(vault.address, MINTER);
      
        //helpers.timeSkip(3*24*60*60+1) //3 days 1s required delay
        helpers.timeSkip(4) //4s for testing purposes otherwise synthetix price feeds become stale
        
        await isoUSD.addRole(vault.address, MINTER);
        const sETHMinMargin = ethers.utils.parseEther("2.0");
        const sUSDMinMargin = ethers.utils.parseEther("1.8");
        const sETHLiqMargin = ethers.utils.parseEther("1.1");
        const sUSDLiqMargin = ethers.utils.parseEther("1.053");
        const sETHInterest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
        const sUSDInterest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
        await collateralBook.addCollateralType(sETH.address, sETHCode, sETHMinMargin, sETHLiqMargin, sETHInterest, SYNTH, ZERO_ADDRESS);
        await collateralBook.addCollateralType(sUSD.address, sUSDCode, sUSDMinMargin, sUSDLiqMargin, sUSDInterest, SYNTH, ZERO_ADDRESS);
        
      });

      beforeEach(async () => {
        snapshotId = await helpers.snapshot(provider);
        //console.log('Snapshotted at ', await provider.getBlockNumber());
      });
    
      afterEach(async () => {
        await helpers.revertChainSnapshot(provider, snapshotId);
        //console.log('Reset block heigh to ', await provider.getBlockNumber());
      });


      
  describe("Construction", function (){
    it("Should deploy the right Synthetix external contract addresses", async function (){
      const EXCHANGE_RATES = addresses.optimism.Exchange_Rates;
      const SYSTEM_STATUS = addresses.optimism.System_Status;
      let PROXY_ERC20 = addresses.optimism.Proxy_ERC20;
      expect( await vault.EXCHANGE_RATES()).to.equal(EXCHANGE_RATES);
      expect( await vault.SYSTEM_STATUS()).to.equal(SYSTEM_STATUS);
      expect( await vault.SUSD_ADDR()).to.equal(sUSDaddr);
      expect( await vault.PROXY_ERC20()).to.equal(PROXY_ERC20);
    });
  });
  

  
   
  describe("OpenLoans", function () {
      const collateralUsed = ethers.utils.parseEther('1000');
      const loanTaken = ethers.utils.parseEther('500');

    it("Should mint user isoUSD if given valid conditions at time zero and emit OpenLoan event", async function () {
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);

      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).openLoan(sUSD.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, sUSDCode,collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));

      const principle = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principle).to.equal(loanTaken)
      const loanAndInterest = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)
      //at time zero this should match principle
      expect(loanAndInterest).to.equal(loanTaken)
      
    });


    it("Should function after pausing and unpausing system", async function () {
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);
      // pause then unpause the vault
      await vault.pause();
      await vault.unpause();

      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).openLoan(sUSD.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, sUSDCode,collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
    });

    it("Should function after pausing and unpausing collateral Synth by Synthetix", async function () {     
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      await suspend_synth(provider, sUSDCode);
      await resume_synth(provider, sUSDCode);

      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).openLoan(sUSD.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, sUSDCode,collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
    });

    it("Should function after pausing and unpausing collateral in CollateralBook", async function () {     
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      expect(await collateralBook.collateralPaused(sUSD.address)).to.equal(false);

      await collateralBook.pauseCollateralType(sUSD.address, sUSDCode);

      expect(await collateralBook.collateralPaused(sUSD.address)).to.equal(true);

      await collateralBook.unpauseCollateralType(sUSD.address, sUSDCode);

      expect(await collateralBook.collateralPaused(sUSD.address)).to.equal(false);
      
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).openLoan(sUSD.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, sUSDCode,collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
    });
  
    it("Should openLoan and record debt corrected after time elasped in system", async function () {  
      //record before balances used for dynamic testing 
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      await sUSD.connect(addr1).approve(vault.address, collateralUsed);

      //accelerate the timestamp
      const timestep = 361;
      helpers.timeSkip(timestep);
      // record virtualPrice before being updated and check its value is correct
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(sUSD.address);
      expect(virtualPrice).to.equal(base);

      //open loan after time has passed
      await expect(vault.connect(addr1).openLoan(sUSDaddr, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, sUSDCode, collateralUsed );
    
      //checks
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
      //virtualDebt should be smaller than loanTaken on account of the virtualPrice being larger
      const virtualDebtBalance = await vault.isoUSDLoanAndInterest(sUSDaddr, addr1.address);
      
      let virtualPriceUpdate = await collateralBook.viewVirtualPriceforAsset(sUSD.address); 
      const debt = loanTaken.mul(base).div(virtualPriceUpdate);
      expect(virtualDebtBalance).to.equal(debt);

      //principle should be unaffected by time changing
      const principle = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principle).to.equal(loanTaken)
      
    });

     // SLOW TEST
     it("Should correctly apply interest accrued after a long time", async function () {
      this.timeout(100000);
      //interest we wish to accrue on loan
      interestToAccrue = 1.375 // i.e. 37.5%
      interestToAccrueBN = ethers.utils.parseEther('1.375');

      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      //approve and open loan
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).openLoan(sUSD.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, sUSDCode,collateralUsed );
      
      //after loan checks
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));

      //update virtualPrice of sUSD
      let steps = timeSkipRequired(interestToAccrue,threeMinInterest)
      year_in_seconds = 60*60*24*365
      expect(steps).to.be.closeTo(year_in_seconds, Math.floor(year_in_seconds*0.01) ) //expect it to be close to 1 year in time
      await cycleVirtualPrice(steps, sUSD)

      const virtualDebtBalance = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address);
      let virtualPriceUpdate = await collateralBook.viewVirtualPriceforAsset(sUSD.address); 
      const debt = virtualDebtBalance.mul(virtualPriceUpdate).div(base)
      //allow an error of 0.1% to account for round down in tests from cycleVirtualPrice
      error = ethers.BigNumber.from(loanTaken.mul(interestToAccrueBN).div(1000).div(base))
      expectedLoan = loanTaken.mul(interestToAccrueBN).div(base)
      expect(debt).to.be.closeTo(expectedLoan, error);

      //approve and open another loan
      await sUSD.connect(owner).transfer(addr2.address, collateralUsed)
      await sUSD.connect(addr2).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr2).openLoan(sUSD.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr2.address, loanTaken, sUSDCode,collateralUsed );
      
      //principle should be unaffected by time changing
      const principle = await vault.isoUSDLoaned(sUSD.address, addr2.address)
      expect(principle).to.equal(loanTaken)

      //virtualDebt should be smaller than loanTaken on account of the virtualPrice being larger
      const virtualDebtBalance_2 = await vault.isoUSDLoanAndInterest(sUSDaddr, addr2.address);
      
      let virtualPriceUpdate_2 = await collateralBook.viewVirtualPriceforAsset(sUSD.address); 
      const debt_2 = loanTaken.mul(base).div(virtualPriceUpdate_2);
      expect(virtualDebtBalance_2).to.equal(debt_2);



      
    });

    it("Should be possible to increase existing loan and emit OpenOrIncreaseLoan event", async function () {
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      smallerLoanTaken = ethers.utils.parseEther('200');
      await vault.connect(addr1).openLoan(sUSDaddr, collateralUsed, smallerLoanTaken);

      const principle = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principle).to.equal(smallerLoanTaken)

      let AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(smallerLoanTaken.mul(base.sub(loanOpenfee)).div(base))
      let AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(smallerLoanTaken.mul(loanOpenfee).div(base));

      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      //here we use a loanIncrease that is less than the minimum initial loan allowed to check increases can be smaller than this.
      const loanIncrease = ethers.utils.parseEther('3');

      await expect(vault.connect(addr1).openLoan(sUSD.address, 0, loanIncrease)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanIncrease, sUSDCode, 0);
      
      const principleAfter = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principleAfter).to.equal(principle.add(loanIncrease))

      AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const isoUSDafterIncrease = beforeAddr1Balance.add((loanIncrease.mul(base.sub(loanOpenfee))).div(base))
      expect(AfterAddr1Balance).to.equal(isoUSDafterIncrease);

      AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const isoUSDafterTreasury = (loanIncrease.mul(loanOpenfee).div(base)).add(beforeTreasuryBalance);
      expect(AfterTreasuryBalance).to.equal(isoUSDafterTreasury);
      
    });

    it("Should only not update virtualPrice if called multiple times within 3 minutes", async function () {
      const minimumLoan = ethers.utils.parseEther('100');
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);

      let tx = await vault.connect(addr1).openLoan(sUSD.address, collateralUsed, minimumLoan)
      let virtualPrice_1 = await collateralBook.viewVirtualPriceforAsset(sUSD.address);
      
      let tx_2 = await vault.connect(addr1).openLoan(sUSD.address, 0, minimumLoan)
      let virtualPrice_2 = await collateralBook.viewVirtualPriceforAsset(sUSD.address);

      //check timestamps are within 3 minutes of each other
      const block_1 = await ethers.provider.getBlock(tx.blockNumber);
      const block_2 = await ethers.provider.getBlock(tx_2.blockNumber);
      const THREE_MINS = 3 *60
      expect(block_1.timestamp).to.be.closeTo(block_2.timestamp, THREE_MINS)

      //if we are within 3 minutes both virtual prices should be the same
      expect(virtualPrice_1).to.equal(virtualPrice_2)
    });

    it("Should only not update another collateral's virtualPrice if called", async function () {
      const minimumLoan = ethers.utils.parseEther('100'); 
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);

      let virtualPrice_other_asset = await collateralBook.viewVirtualPriceforAsset(sETH.address);

      await vault.connect(addr1).openLoan(sUSD.address, collateralUsed, minimumLoan)
      
      let virtualPrice_other_asset_after = await collateralBook.viewVirtualPriceforAsset(sETH.address);
      
      //if we are within 3 minutes both virtual prices should be the same
      expect(virtualPrice_other_asset).to.equal(virtualPrice_other_asset_after)
    });
    
    it("Should fail if daily max Loan amount exceeded", async function () {
      await vault.connect(owner).setDailyMax(1000);
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(
        vault.connect(addr1).openLoan(sUSD.address, collateralUsed, loanTaken)
      ).to.be.revertedWith("Try again tomorrow loan opening limit hit");
    });
    
    it("Should fail if using unsupported collateral token", async function () {
      await expect(
        vault.connect(addr2).openLoan(FakeAddr, 1000000, 500000)
      ).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail if vault paused", async function () {
      await vault.pause();
      await expect(
        vault.connect(addr2).openLoan(sETH.address, collateralUsed, loanTaken)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should fail if collateral is paused in CollateralBook", async function () {
      await collateralBook.pauseCollateralType(sETH.address, sETHCode);
      await expect(
        vault.connect(addr2).openLoan(sETH.address, collateralUsed, loanTaken)
      ).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail if the market is closed", async function () {
      await suspend_synth(provider, sUSDCode);
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(
        vault.connect(addr1).openLoan(sUSD.address, collateralUsed, loanTaken)
      ).to.be.revertedWith("Synth is suspended. Operation prohibited");
    });


    it("Should fail if sender doesn’t have enough collateral tokens", async function () {
      const initialAddr2Balance = await isoUSD.balanceOf(addr2.address);
      expect(initialAddr2Balance).to.equal(0);
      await sUSD.connect(addr2).approve(vault.address, collateralUsed);
      await expect(
        vault.connect(addr2).openLoan(sUSDaddr, collateralUsed, loanTaken)
      ).to.be.revertedWith('User lacks collateral quantity!');
    });

    it("Should fail if sender requests too much isoUSD", async function () {
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(
        vault.connect(addr1).openLoan(sUSDaddr, collateralUsed, loanTaken.mul(4))
      ).to.be.revertedWith("Minimum margin not met!");
    });

    it("Should fail if sender posts no collateral ", async function () {
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(
        vault.connect(addr1).openLoan(sUSDaddr, 0, loanTaken)
      ).to.be.revertedWith("Minimum margin not met!"); 

    });

    it("Should fail if vault isn't an approved token spender ", async function () {
      await sUSD.connect(addr1).transfer(addr2.address, collateralUsed)
      await expect(
        vault.connect(addr2).openLoan(sUSDaddr, collateralUsed, loanTaken)
      ).to.be.revertedWith("SafeMath: subtraction overflow"); 

    });
    
    it("Should fail if loan requested does not meet minimum size", async function () {
      let tooSmallAmount = ethers.utils.parseEther('1');
      await expect(
        vault.connect(addr1).openLoan(sUSDaddr, collateralUsed, tooSmallAmount)
      ).to.be.revertedWith("Loan Requested too small"); 

    });
    
  });
  
  
  describe("Increase existing loan by openLoan ", function () {
    const collateralUsed = ethers.utils.parseEther('1000');
    const loanTaken = ethers.utils.parseEther('200');

    beforeEach(async function () {
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await vault.connect(addr1).openLoan(sUSDaddr, collateralUsed, loanTaken);
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(loanTaken.mul(base.sub(loanOpenfee)).div(base))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
    });

    //duplicate test?
    it("Should mint user isoUSD if possible and emit OpenLoan event", async function () {
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const loanIncrease = ethers.utils.parseEther('300');
      await expect(vault.connect(addr1).openLoan(sUSD.address, 0, loanIncrease)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanIncrease, sUSDCode, 0);
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanIncrease.mul(base.sub(loanOpenfee))).div(base)))
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(beforeTreasuryBalance.add(loanIncrease.mul(loanOpenfee).div(base))); 
    });

    //SLOW TEST
    it("Should still increase loan after accrued interest if possible", async function () {
      let steps = timeSkipRequired(1.01, threeMinInterest) //interest to achieve i.e 1%
      await cycleVirtualPrice(steps, sUSD);
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);

      //we request a loan that places us slightly below the maximum loan allowed
      const loanIncrease = ethers.utils.parseEther('353');
      await expect(vault.connect(addr1).openLoan(sUSD.address, 0,loanIncrease)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanIncrease, sUSDCode, 0);
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanIncrease.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(beforeTreasuryBalance.add(loanIncrease.mul(loanOpenfee).div(base))); 
      
    });
    //SLOW TEST
    it("Should fail to increase debt if interest accrued is too high", async function () {
      let steps = timeSkipRequired(1.01, threeMinInterest) //interest to achieve i.e 1%
      await cycleVirtualPrice(steps, sUSD);
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      //we request a loan that places us slightly over the maximum loan allowed
      const loanIncrease = ethers.utils.parseEther('354');
      //let virtualPrice = await collateralBook.viewVirtualPriceforAsset(sUSD.address);
      await expect(vault.connect(addr1).openLoan(sUSD.address,0, loanIncrease)).to.be.revertedWith("Minimum margin not met!");
      
    });

    it("Should fail if the user has no existing loan", async function () {
      
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const loanIncrease = ethers.utils.parseEther('300');
      await expect(vault.connect(addr2).openLoan(sUSD.address,0, loanIncrease)).to.be.revertedWith("Minimum margin not met!");
      
    });
    
    it("Should fail if daily max Loan amount exceeded", async function () {

      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const loanIncrease = ethers.utils.parseEther('300');
      await vault.setDailyMax(1000);
      await expect(vault.connect(addr1).openLoan(sUSD.address, 0,loanIncrease)).to.be.revertedWith("Try again tomorrow loan opening limit hit");
    });
    
    it("Should fail if using unsupported collateral token", async function () {

      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const loanIncrease = ethers.utils.parseEther('300');
      await expect(vault.connect(addr1).openLoan(sBTC.address,0, loanIncrease)).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail if sender requests too much isoUSD", async function () {
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const loanIncrease = ethers.utils.parseEther('3000');
      await expect(vault.connect(addr1).openLoan(sUSD.address, 0, loanIncrease)).to.be.revertedWith("Minimum margin not met!");
    });
    
    
  });
  

   
  describe("increaseCollateralAmount", function () {
    const totalCollateralUsing = ethers.utils.parseEther('1000');
    const collateralUsed = ethers.utils.parseEther('900');
    const loanTaken = ethers.utils.parseEther('200');
    beforeEach(async function () {
      
      await sUSD.connect(addr1).approve(vault.address, totalCollateralUsing);
      await vault.connect(addr1).openLoan(sUSDaddr, collateralUsed, loanTaken);
      const afterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(afterAddr1Balance).to.equal(loanTaken.mul(base.sub(loanOpenfee)).div(base))
      const afterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(afterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
    });

    it("Should increase user loan collateral on existing loan and emit IncreaseCollateral event", async function () {
      //collect data for checks after call     
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const beforeAddr1Collateral = await sUSD.balanceOf(addr1.address);
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
      const principleBefore = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      
      
      await expect(vault.connect(addr1).increaseCollateralAmount(sUSD.address, collateralAdded)).to.emit(vault, 'IncreaseCollateral').withArgs(addr1.address, sUSDCode, collateralAdded );
      
      //recorded loan should not have changed
      const principleAfter = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principleAfter).to.equal(principleBefore)

      //loan should not have increased
      const afterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(afterAddr1Balance).to.equal(beforeAddr1Balance);
      
      //fees earnt by treasury should not have increased
      const afterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(afterTreasuryBalance).to.equal(beforeTreasuryBalance);

      //user collateral balance should have decreased
      const afterAddr1Collateral = await sUSD.balanceOf(addr1.address);
      expect(afterAddr1Collateral).to.equal(beforeAddr1Collateral.sub(collateralAdded));
      
    });

    it("Should function after pausing and unpausing system", async function () {
      
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const beforeAddr1Collateral = await sUSD.balanceOf(addr1.address);
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)

      //pause and unpause
      await vault.pause();
      await vault.unpause();

      await expect(vault.connect(addr1).increaseCollateralAmount(sUSD.address, collateralAdded)).to.emit(vault, 'IncreaseCollateral').withArgs(addr1.address, sUSDCode, collateralAdded );
      
      const afterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(afterAddr1Balance).to.equal(beforeAddr1Balance);

      const afterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(afterTreasuryBalance).to.equal(beforeTreasuryBalance);

      const afterAddr1Collateral = await sUSD.balanceOf(addr1.address);
      expect(afterAddr1Collateral).to.equal(beforeAddr1Collateral.sub(collateralAdded));
      
    });

    it("Should fail if accrued interest means debt is still too large", async function () {
      const loanIncrease = ethers.utils.parseEther('300');
      await vault.connect(addr1).openLoan(sUSD.address, 0, loanIncrease);
      //alter liquidationMargin level to make it close to openingMargin level to make situation much easier to setup
      const sUSDMinMargin = ethers.utils.parseEther("1.8");
      const sUSDLiqMargin = ethers.utils.parseEther("1.79");
      const sUSDInterest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
  
      await collateralBook.queueCollateralChange(sUSD.address, sUSDCode, sUSDMinMargin, sUSDLiqMargin, sUSDInterest, SYNTH, ZERO_ADDRESS);
      const timeToSkip = await collateralBook.CHANGE_COLLATERAL_DELAY();
      await helpers.timeSkip(timeToSkip.toNumber());
      await collateralBook.changeCollateralType();
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const beforeAddr1Collateral = await sUSD.balanceOf(addr1.address);
      
      //determine the number of steps to achieve our required interest accrued  
      // and then skip time ahead and update the asset virtualPrice
      let steps = timeSkipRequired(1.05, threeMinInterest) //interest to achieve i.e 1%
      await cycleVirtualPrice(steps, sUSD);

      //try to add a small amount of collateral to the loan
      const collateralUsed = ethers.utils.parseEther('2');
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).increaseCollateralAmount(sUSD.address, collateralUsed)).to.be.revertedWith("Liquidation margin not met!");
      
    });
    
    
    it("Should fail if using unsupported collateral token", async function () {
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
      await sBTC.connect(addr1).approve(vault.address, collateralAdded);
      await expect(vault.connect(addr1).increaseCollateralAmount(sBTC.address, collateralAdded)).to.be.revertedWith("Unsupported collateral!");
      
    });

    it("Should fail if vault paused", async function () {
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
      await vault.pause();
      await expect(vault.connect(addr1).increaseCollateralAmount(sUSD.address, collateralAdded)).to.be.revertedWith("Pausable: paused");
      
      
    });

    it("Should fail if collateral is paused in CollateralBook", async function () {
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
      //pause collateral in collateralBook
      await collateralBook.pauseCollateralType(sUSD.address, sUSDCode);

      await expect(vault.connect(addr1).increaseCollateralAmount(sUSD.address, collateralAdded)).to.be.revertedWith("Unsupported collateral!");
      
    });

    it("Should fail if the market is closed", async function () {
      
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
      await suspend_synth(provider, sUSDCode);
      await expect(vault.connect(addr1).increaseCollateralAmount(sUSD.address, collateralAdded)).to.be.revertedWith("Synth is suspended. Operation prohibited");
    });

    it("Should fail if sender doesn’t have enough collateral tokens", async function () {
      const beforeAddr1Balance = await sUSD.balanceOf(addr1.address);
      const collateralUsed = beforeAddr1Balance.add(1);
      await sUSD.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).increaseCollateralAmount(sUSD.address, collateralUsed)).to.be.revertedWith("User lacks collateral amount");
    });

    
    it("Should fail if sender posts no collateral ", async function () {
      await expect(vault.connect(addr1).increaseCollateralAmount(sUSD.address, 0)).to.be.revertedWith("Zero amount");
    });

    it("Should fail if sender never opened loan originally ", async function () {
      const collateralAdded = ethers.utils.parseEther('100');
      await expect(vault.connect(addr2).increaseCollateralAmount(sUSD.address, collateralAdded)).to.be.revertedWith("No existing collateral!");
    });
    
    
  });
  describe("CloseLoans", function () {
    //the 2 after these vars is because it was grabbing the wrong value from somewhere else, can't find where
    const collateralAmount2 = ethers.utils.parseEther("1000");
    const loanAmount2 = collateralAmount.div(2)
    beforeEach(async function () {
      
      await sUSD.connect(addr1).approve(vault.address, collateralAmount2);
      await vault.connect(addr1).openLoan(sUSDaddr, collateralAmount2, loanAmount2);
      
      //then we make a small loan for the purposes of nullifying the impact
      // of the openLoanFee and time elapsed interest due.
      await sUSD.connect(owner).transfer(addr2.address, collateralAmount2);
      await sUSD.connect(addr2).approve(vault.address, collateralAmount2);
      await vault.connect(addr2).openLoan(sUSDaddr, collateralAmount2, loanAmount2);
      
      const isoUSDamount = await isoUSD.balanceOf(addr2.address);
      await isoUSD.connect(addr2).transfer(addr1.address, isoUSDamount);

  
    });

    it("Should return user isoUSD if valid conditions are met and emit ClosedLoan event", async function () {
    
      let realDebt = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(sUSD.address);
      
      //quantity of isoUSD to repay
      const valueClosing = realDebt.mul(virtualPrice).div(e18);

      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      const beforeColBalance = await sUSD.balanceOf(addr1.address);

      //request full collateral amount back
      const requestedCollateral = collateralAmount;

      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect (vault.connect(addr1).closeLoan(sUSDaddr, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, sUSDCode, requestedCollateral);
      
      //a fully paid loan should repay all principle
      const principle = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principle).to.equal(0)

      //a fully repaid loan should repay all interest also
      const totalLoan = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)
      expect(totalLoan).to.equal(0)

      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));

      //check the fees accumulated in the treasury
      const TreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      let TreasuryisoUSDDifference = TreasuryisoUSDBalance.sub(beforeTreasuryisoUSDBalance)
      let expectedFees = valueClosing.sub(loanAmount2)
      expect(TreasuryisoUSDDifference).to.equal(expectedFees)

      const AfterColBalance = await sUSD.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));
    });

    it("Should return user collateral if valid conditions are met and emit ClosedLoan event after interest has accrued", async function () {
      //time skip to cycle virtualPrice and accrue interest on loan
      let timeJump = timeSkipRequired(1.011, threeMinInterest);
      await cycleVirtualPrice(timeJump, sUSD);

      let realDebt = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(sUSD.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18)

      //store data for checks after call.
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeColBalance = await sUSD.balanceOf(addr1.address);
      const requestedCollateral = collateralAmount;
      
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)
      const principleBefore = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      const isoUSDTreasuryBefore = await isoUSD.balanceOf(treasury.address);

      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect (vault.connect(addr1).closeLoan(sUSDaddr, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan')
      
      //a fully paid loan should repay all principle
      const principle = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principle).to.equal(0)
      //a fully repaid loan should repay all interest also
      const totalLoan = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)
      expect(totalLoan).to.equal(0)
      //expect all the repaid loan to be removed from the user
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));

      //user should have loan collateral returned
      const AfterColBalance = await sUSD.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));

      //expect interst to have been paid to the treasury
      const isoUSDTreasury = await isoUSD.balanceOf(treasury.address);
      const expectedFees = (totalLoanBefore.mul(virtualPrice).div(e18)).sub(principleBefore)
      expect(isoUSDTreasury.sub(isoUSDTreasuryBefore)).to.equal(expectedFees);

      
    });

    it("Should return full user isoUSD if remaining debt is less than $0.001", async function () {
      
      let realDebt = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(sUSD.address);
      const valueClosing = (realDebt.mul(virtualPrice).div(e18)).sub(100);
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeColBalance = await sUSD.balanceOf(addr1.address);
      const principleBefore = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      const requestedCollateral = collateralAmount;

      //approve loan repayment and call closeLoan
      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect (vault.connect(addr1).closeLoan(sUSDaddr, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, sUSDCode, requestedCollateral);
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));

      const AfterColBalance = await sUSD.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));

      //a fully paid loan should repay nearly all principle leaving only dust behind
      const principle = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      let error = principleBefore.div(100000) //0.001%
      expect(principle).to.be.closeTo(zero, error)

      //a fully repaid loan should repay all interest also, minus dust again 
      const totalLoan = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)
      expect(totalLoan).to.be.closeTo(zero, error)
    });

    it("Should allow reducing margin ratio if in excess by drawing out collateral", async function () {
      let realDebt = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(sUSD.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18);

      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeColBalance = await sUSD.balanceOf(addr1.address);

      
      await isoUSD.connect(addr1).approve(vault.address, valueClosing);

      const requestedCollateral = collateralAmount
      await expect(vault.connect(addr1).closeLoan(sUSDaddr, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, sUSDCode, requestedCollateral);
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      let leftoverisoUSD = beforeisoUSDBalance.sub(valueClosing)
      expect(AfterisoUSDBalance).to.equal(leftoverisoUSD);

      const AfterColBalance = await sUSD.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));

      //Now a neutral position is acquired, reopen loan with excess margin
      collateralPaid = ethers.utils.parseEther("1000");
      await sUSD.connect(addr1).approve(vault.address, collateralPaid);
      const loanTaking = collateralPaid.div(5)
      await vault.connect(addr1).openLoan(sUSDaddr, collateralPaid, loanTaking );

      const middleisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(middleisoUSDBalance).to.equal(leftoverisoUSD.add(loanTaking.mul(base.sub(loanOpenfee)).div(base)));

      const middleColBalance = await sUSD.balanceOf(addr1.address);
      expect(middleColBalance).to.equal(AfterColBalance.sub(collateralPaid));

      const principleBefore = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)

      const requestedCollateral2 = ethers.utils.parseEther("500");
      await expect(vault.connect(addr1).closeLoan(sUSDaddr, requestedCollateral2, 0)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, 0, sUSDCode, requestedCollateral2);
      
      //if no loan is repaid then the principle owed should stay the same 
      const principle = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principle).to.equal(principleBefore)

      //if no loan is repaid then the loan and interest owed should stay the same 
      const totalLoan = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)
      expect(totalLoan).to.equal(totalLoanBefore)

      const finalisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(finalisoUSDBalance).to.equal(leftoverisoUSD.add(loanTaking.mul(base.sub(loanOpenfee)).div(base)));

      const finalColBalance = await sUSD.balanceOf(addr1.address);
      expect(finalColBalance).to.equal(middleColBalance.add(requestedCollateral2));
    });

    it("Should allow partial closure of loan if valid conditions are met", async function () {

      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      const beforeColBalance = await sUSD.balanceOf(addr1.address);
      const valueClosing = ethers.utils.parseEther("250");
      const requestedCollateral = ethers.utils.parseEther("500");
      const principleBefore = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)

      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect(vault.connect(addr1).closeLoan(sUSDaddr, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, sUSDCode, requestedCollateral);
      
      //the principle should partial decrease 
      const principle = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principle).to.equal(principleBefore.sub(valueClosing))

      //no interest is paid but the partial principle decrease should be reflected
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(sUSD.address);
      const totalLoan = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)
      const expectedTotalLoan = totalLoanBefore.sub(valueClosing.mul(base).div(virtualPrice))
      expect(totalLoan).to.equal(expectedTotalLoan)

      //as we have paid no interest there should be no fee paid to the treasury yet
      const TreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      expect(TreasuryisoUSDBalance).to.equal(beforeTreasuryisoUSDBalance)

      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing))

      const AfterColBalance = await sUSD.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral))
    });

    it("Should allow partial closure of loan with no collateral repaid to user", async function () {
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeColBalance = await sUSD.balanceOf(addr1.address);
      const valueClosing = ethers.utils.parseEther("250");
      const requestedCollateral = 0;
      const principleBefore = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)

      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect(vault.connect(addr1).closeLoan(sUSDaddr, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, sUSDCode, requestedCollateral);
      
      //the principle should partial decrease 
      const principle = await vault.isoUSDLoaned(sUSD.address, addr1.address)
      expect(principle).to.equal(principleBefore.sub(valueClosing))

      //no interest is paid but the partial principle decrease should be reflected
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(sUSD.address);
      const totalLoan = await vault.isoUSDLoanAndInterest(sUSD.address, addr1.address)
      const expectedTotalLoan = totalLoanBefore.sub(valueClosing.mul(base).div(virtualPrice))
      expect(totalLoan).to.equal(expectedTotalLoan)

      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing))

      const AfterColBalance = await sUSD.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));
    });
    

    it("Should fail to close if the market is closed", async function () {
      await suspend_synth(provider, sUSDCode);
      await expect(
        vault.connect(addr1).closeLoan(sUSDaddr, collateralAmount2, loanAmount2)
      ).to.be.revertedWith("Synth is suspended. Operation prohibited");
    });

    it("Should fail to close if the contract is paused", async function () {
      await vault.pause();
      await expect(
        vault.connect(addr1).closeLoan(sUSDaddr, collateralAmount2, loanAmount2)
      ).to.be.revertedWith("Pausable: paused");

    });

    it("Should fail to close if collateral is paused in CollateralBook", async function () {
      await collateralBook.pauseCollateralType(sUSD.address, sUSDCode);
      await expect(
        vault.connect(addr1).closeLoan(sUSDaddr, collateralAmount2, loanAmount2)
      ).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail to close if an invalid collateral is used", async function () {
      await expect(
        vault.connect(addr1).closeLoan(FakeAddr, collateralAmount2, loanAmount2)
      ).to.be.revertedWith("Unsupported collateral!");

    });

    it("Should fail to close if user asks for more collateral than originally posted", async function () {
      await expect(
        vault.connect(addr1).closeLoan(sUSDaddr, collateralAmount2.add(1), loanAmount2)
      ).to.be.revertedWith("User never posted this much collateral!");

    });

    it("Should fail to close if user has insufficient isoUSD", async function () {
      const isoUSDAmount = await isoUSD.balanceOf(addr1.address);
      await isoUSD.connect(addr1).transfer(addr2.address, isoUSDAmount);
  
      await expect(
        vault.connect(addr1).closeLoan(sUSDaddr, collateralAmount2, loanAmount2)
      ).to.be.revertedWith("Insufficient user isoUSD balance!");
    });

    it("Should fail to close if user tries to return more isoUSD than borrowed originally", async function () {
      //take another loan to get more isoUSD to send to addr1
      await sUSD.connect(owner).transfer(addr2.address, collateralAmount);
      await sUSD.connect(addr2).approve(vault.address, collateralAmount);
      await vault.connect(addr2).openLoan(sUSDaddr, collateralAmount2, loanAmount2);
      const isoUSDAmount = await isoUSD.balanceOf(addr2.address);
      await isoUSD.connect(addr2).transfer(addr1.address, isoUSDAmount );

      await expect(
        //try to repay loan plus a small amount
        vault.connect(addr1).closeLoan(sUSDaddr, collateralAmount2, loanAmount2.mul(11).div(10))
      ).to.be.revertedWith("Trying to return more isoUSD than borrowed!");
    });

    it("Should fail to close if partial loan closure results in an undercollateralized loan", async function () {
      await sUSD.connect(owner).transfer(addr2.address, collateralAmount2);
      await sUSD.connect(addr2).approve(vault.address, collateralAmount2);
      await vault.connect(addr2).openLoan(sUSDaddr, collateralAmount2, collateralAmount2.div(2));

      //attempt to take back all collateral repaying nothing
      await expect(
        vault.connect(addr2).closeLoan(sUSDaddr, collateralAmount2, 0)
      ).to.be.revertedWith("Remaining debt fails to meet minimum margin!");
      //attempt to take back all collateral repaying some of loan
      await expect(
        vault.connect(addr2).closeLoan(sUSDaddr, collateralAmount2, collateralAmount2.div(3))
      ).to.be.revertedWith("Remaining debt fails to meet minimum margin!");
    });
    

    
  });

  
  describe("viewLiquidatableAmount", function () {
    //helper function that quickly formats inputs, calculates in JS then calls using the same formats to the function
    async function compareLiquidationAmount(priceStr, collateralStr, liquidationMarginStr, loanAmountStr, percentageReturnedStr){
      let output
      price = ethers.utils.parseEther(priceStr);
      collateral = ethers.BigNumber.from(collateralStr);
      liquidationMargin = ethers.utils.parseEther(liquidationMarginStr);
      loanAmount = ethers.BigNumber.from(loanAmountStr);
      percentageReturned = ethers.utils.parseEther(percentageReturnedStr);
      let minimumCollatPoint = loanAmount.mul(liquidationMargin);
      let actualCollatPoint = price.mul(collateral)
      let top = (minimumCollatPoint.sub(actualCollatPoint)).mul(base).div(liquidationMargin);
      if (minimumCollatPoint <= actualCollatPoint){
        output = ethers.BigNumber.from("0");
      }
      else{
        let bottom = price.mul(percentageReturned.sub((base.mul(base).div(liquidationMargin)))).div(base)
        output = top.div(bottom);
      }

      if (output.lte(0)){
        //negative values return indicate no liquidatable, reset the output to zero in this case
        output = ethers.BigNumber.from("0");
      }
      expect(await vault.viewLiquidatableAmount(collateral, price, loanAmount, liquidationMargin)).to.be.closeTo(output, 20);
      
    }

    it("Should return the correct liquidation quantity", async function () {
      //here we rewrite the function in JS to allow us to verify any possible liquidation quantities
      //prime candidate for fuzzing
      const colAmount = ["2770", "277", "2770", "2770", "2770", "2770", "1", "1", "10"];
      const colPrice = ["3753.03379", "3753.03379", "4000", "3753.03379","3753.03379", "3753.03379","2", "1", "1"];
      const debt = ["10000000", "10000000", "10000000", "10000", "10000000", "5000000", "1", "1", "10" ];
      const minimumMarginRatio = ["7.0", "7.0","7.0", "7.0", "1.1", "1.1", "2.0", "2.0", "2.0"];
      const LIQUIDATION_BONUS = "0.95";
      for (let i = 0; i < colAmount.length; i++){ 
        let liquidationSize =  await compareLiquidationAmount(colPrice[i], colAmount[i], minimumMarginRatio[i], debt[i], LIQUIDATION_BONUS );
      }

    });

  });
  
  describe("callLiquidation", function () {

    let liquidationLoanSize;

    beforeEach(async function () {
      this.timeout(100000);
      //set up a loan that is liquidatable
      liq_return = await vault.LIQUIDATION_RETURN();
      let donerAmount2 = ethers.utils.parseEther('10'); //10 sETH;
      await impersonateForToken(provider, addr1, sETH, SETHDoner, donerAmount2)
      await sETH.connect(addr1).approve(vault.address, donerAmount2);
      let divider = 1000;
      let numerator = 1001;
      
      const sETHMinMargin2 = ethers.utils.parseEther((numerator/divider).toString(10), "ether")
      const sETHLiqMargin2 = ethers.utils.parseEther("1.0");
      // ~2340% APR, this allows us to add interest quickly, continiously compounding each 180s
      const sETHInterest2 = ethers.utils.parseEther("1.0000180"); 
      await collateralBook.TESTchangeCollateralType(sETH.address, sETHCode, sETHMinMargin2, sETHLiqMargin2, sETHInterest2,  ZERO_ADDRESS, liq_return.mul(2), SYNTH);   //fake LIQ_RETURN used for ease of tests   
      
      let collateralValue = await vault.priceCollateralToUSD(sETHCode, colQuantity);
      liquidationLoanSize = collateralValue.div(numerator).mul(divider)
      await vault.connect(addr1).openLoan(sETH.address, colQuantity, liquidationLoanSize); //i.e. 10mill / 1.1 so liquidatable
      const openingVirtualPrice = await collateralBook.viewVirtualPriceforAsset(sETH.address);
      const sETHMinMargin3 = ethers.utils.parseEther("2.0");
      const sETHLiqMargin3 = ethers.utils.parseEther("1.1");
      await collateralBook.TESTchangeCollateralType(sETH.address, sETHCode, sETHMinMargin3, sETHLiqMargin3, sETHInterest2, ZERO_ADDRESS, liq_return.mul(2), SYNTH); //fake LIQ_RETURN used for ease of tests
      let loanReceived = await isoUSD.balanceOf(addr1.address); 
      await isoUSD.connect(addr1).transfer(addr2.address, loanReceived);  
      //openLoan didn't verify conditions remain after changing collateral properties so verifying here
      let debt = (await vault.isoUSDLoanAndInterest(sETHaddr, addr1.address)).mul(openingVirtualPrice).div(e18)
      //debt = Math.ceil(debt);
      //occasional rounding errors so we can't check exactly.
      expect(debt).to.be.closeTo(liquidationLoanSize, 2);
      expect(await vault.collateralPosted(sETHaddr, addr1.address)).to.equal(colQuantity);
      
       
       
    });

    it("Should liquidate if entire loan is eligible to liquidate and emit Liquidation & BadDebtCleared events", async function () {
      liq_return = await vault.LIQUIDATION_RETURN();
      const helperAmount = ethers.utils.parseEther("1000");
      const helperLoan = helperAmount.div(2);
      //open a loan with address 2 to have isoUSD with which to repay loan being liquidated
      await sUSD.connect(owner).transfer(addr2.address, helperAmount);
      await sUSD.connect(addr2).approve(vault.address, helperAmount);
      const beforeLoanisoUSD = await isoUSD.balanceOf(addr2.address);
      await vault.connect(addr2).openLoan(sUSDaddr, helperAmount, helperLoan);

      //before liquidation checks
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      receivedLoan = helperLoan.mul(base.sub(loanOpenfee)).div(base);
      expect(beforeisoUSDBalance).to.equal(beforeLoanisoUSD.add(receivedLoan));

      const beforeColBalance = await sETH.balanceOf(vault.address);
      expect(beforeColBalance).to.equal(colQuantity);

      const beforeColLiquidatorBalance = await sETH.balanceOf(addr2.address);
      expect(beforeColLiquidatorBalance).to.equal(0);

      //modify minimum collateral ratio to enable liquidation
      const sETHMinMargin4 = ethers.utils.parseEther("8.0");
      const sETHLiqMargin4 = ethers.utils.parseEther("7.0");
      const sETHInterest4 = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
      await collateralBook.TESTchangeCollateralType(sETH.address, sETHCode, sETHMinMargin4, sETHLiqMargin4, sETHInterest4, ZERO_ADDRESS, liq_return, SYNTH);      
      
      const totalCollateralinisoUSD = await vault.priceCollateralToUSD(sETHCode, colQuantity); //Math.round(ethPrice * colQuantity);
      const amountLiquidated = totalCollateralinisoUSD.mul(base.sub(liquidatorFeeBN)).div(base); 
      const virtualDebtBegin = await vault.isoUSDLoanAndInterest(sETHaddr, addr1.address);
      ethPriceBN =  await vault.priceCollateralToUSD(sETHCode, e18);
      let isoUSDRepaid = await vault.viewLiquidatableAmount(colQuantity, ethPriceBN, loanSizeInisoUSD, sETHLiqMargin4)
      
       //isoUSD repayment approval and liquidation call
      await isoUSD.connect(addr2).approve(vault.address, beforeisoUSDBalance)
      const call = await vault.connect(addr2).callLiquidation(addr1.address, sETHaddr);
      expect(call).to.emit(vault, 'Liquidation').withArgs(addr1.address, addr2.address, amountLiquidated-1, sETHCode, colQuantity);
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      expect(AfterisoUSDBalance).to.closeTo(beforeisoUSDBalance.sub(amountLiquidated), 1);

      const AfterColVaultBalance = await sETH.balanceOf(vault.address);
      expect(AfterColVaultBalance).to.equal(0); 

      const AfterColLiquidatorBalance = await sETH.balanceOf(addr2.address);
      expect(AfterColLiquidatorBalance).to.equal(beforeColLiquidatorBalance+colQuantity);

      //because there is a bad debt both principle and interest owed should be wiped to 0 as these would never be repaid otherwise
      const virtualPriceEnd = await collateralBook.viewVirtualPriceforAsset(sETH.address);
      const realDebt = (await vault.isoUSDLoanAndInterest(sETHaddr, addr1.address)).mul(virtualPriceEnd).div(e18)
      expect(realDebt).to.equal(0);

      const principle = await vault.isoUSDLoaned(sETHaddr, addr1.address)
      expect(principle).to.equal(0);

      //with complete liquidation there should be no collateral leftover in the vault for the original loan holder either
      expect(await vault.collateralPosted(sETHaddr, addr1.address)).to.equal(0);

      //a bad debt event should be emitted logging how much of the loan&interest was unpaid
      const badDebtQuantity = (virtualDebtBegin.mul(virtualPriceEnd).div(base)).sub(amountLiquidated);
      expect(call).to.emit(vault, 'BadDebtCleared').withArgs(addr1.address, addr2.address, badDebtQuantity+1, sETHCode);
      
    });
    
    it("Should liquidate correctly for outstanding loan interest when loan principle has already been fully repaid", async function(){
      
      const helperAmount = ethers.utils.parseEther("1000");
      const helperLoan = helperAmount.div(2);
      //open a loan with address 2 to have isoUSD with which to repay loan being liquidated
      await sUSD.connect(owner).transfer(addr2.address, helperAmount);
      await sUSD.connect(addr2).approve(vault.address, helperAmount);
      const beforeLoanisoUSD = await isoUSD.balanceOf(addr2.address);
      await vault.connect(addr2).openLoan(sUSDaddr, helperAmount, helperLoan);

      //timeskip to accrue interest on loan 
      const sETHInterest2Decimal = 100001800
      let steps = timeSkipRequired(1.10, sETHInterest2Decimal) //interest to achieve i.e 10%
      await cycleVirtualPrice(steps, sETH);

      //set nearly 1:1 collateral to loan requirements to make situation set up easier again 
      const sETHMinMargin2 = ethers.utils.parseEther("1.001")
      const sETHLiqMargin2 = ethers.utils.parseEther("1.0");
      // ~2340% APR, this allows us to add interest quickly, continiously compounding each 180s
      const sETHInterest2 = ethers.utils.parseEther("1.0000180"); 
      await collateralBook.TESTchangeCollateralType(sETH.address, sETHCode, sETHMinMargin2, sETHLiqMargin2, sETHInterest2,  ZERO_ADDRESS, liq_return.mul(2), SYNTH);   //fake LIQ_RETURN used for ease of tests   
      

      let principleRepaid = await vault.isoUSDLoaned(sETH.address, addr1.address)
      await isoUSD.connect(addr2).transfer(addr1.address, principleRepaid)
      //after repaying principle, we should have roughly 10% left as loan interest so we withdraw 89% of collateral to bring loan close to liquidatable again.
      let collateralWithdrawn = colQuantity.mul(89).div(100)

      //repay loan principle leaving behind interest
      await isoUSD.connect(addr1).approve(vault.address, principleRepaid)
      await vault.connect(addr1).closeLoan(sETH.address, collateralWithdrawn, principleRepaid);

      //check principle has been fully repaid but interest has not
      expect( await vault.isoUSDLoaned(sETH.address, addr1.address)).to.equal(0)
      let interestRemaining = await vault.isoUSDLoanAndInterest(sETH.address, addr1.address)
      expect(interestRemaining).to.be.greaterThan(0)
      let virtualPrice1 = await collateralBook.viewVirtualPriceforAsset(sETH.address);

      //modify minimum and liquidation collateral ratios to enable liquidation
      const sETHMinMargin4 = ethers.utils.parseEther("8.0");
      const sETHLiqMargin4 = ethers.utils.parseEther("7.0");
      const sETHInterest4 = ethers.utils.parseEther("1.00000180"); // roughly 37% APR
      await collateralBook.TESTchangeCollateralType(sETH.address, sETHCode, sETHMinMargin4, sETHLiqMargin4, sETHInterest4, ZERO_ADDRESS, liq_return, SYNTH);      
      
      let leftoverCollateral = await vault.collateralPosted(sETH.address, addr1.address)
      

      //isoUSD repayment approval and liquidation call
      let liquidatorBalance = await isoUSD.balanceOf(addr2.address)
      await isoUSD.connect(addr2).approve(vault.address, liquidatorBalance)
      const tx = await vault.connect(addr2).callLiquidation(addr1.address, sETHaddr)
      
      //check liquidation event args
      const virtualPriceEnd = await collateralBook.viewVirtualPriceforAsset(sETH.address);
      const realLoanOwed = interestRemaining.mul(virtualPriceEnd).div(e18);
      ethPriceBN = await vault.priceCollateralToUSD(sETHCode, e18);
      const liquidateCollateral = await vault.viewLiquidatableAmount(leftoverCollateral, ethPriceBN, realLoanOwed, sETHLiqMargin4)
      const liquidatorPayback = (await vault.priceCollateralToUSD(sETHCode, liquidateCollateral)).mul(base.sub(liquidatorFeeBN)).div(base); 
      
      await expect (tx).to.emit(vault, 'Liquidation').withArgs(addr1.address, addr2.address, liquidatorPayback, sETHCode, liquidateCollateral);  
      
      //determine how much isoUSD the liquidator paid
      let liquidatorPaid = liquidatorBalance.sub(await isoUSD.balanceOf(addr2.address))
      //check this matches the written off interest
      let unpaidInterest = await vault.isoUSDLoanAndInterest(sETH.address, addr1.address)
      let virtualPrice2 = await collateralBook.viewVirtualPriceforAsset(sETH.address);
      let paidInterest = (interestRemaining.mul(virtualPrice1).div(base)).sub(unpaidInterest.mul(virtualPrice2).div(base))

      expect(liquidatorPaid).to.be.closeTo(paidInterest, 1) //rounding error adjustment

      //check principle owed is still zero
      expect( await vault.isoUSDLoaned(sETH.address, addr1.address)).to.equal(0)
      
    })

    
    it("Should partially liquidate loan if possible and emit Liquidation event", async function () {
      //need to open loan for addr2 here
      const reduceAmount = ethers.utils.parseEther("304");
      await sUSD.connect(owner).transfer(addr2.address, reduceAmount.mul(2));
      await sUSD.connect(addr2).approve(vault.address, reduceAmount.mul(2))
      await vault.connect(addr2).openLoan(sUSDaddr, reduceAmount.mul(2), reduceAmount);
      const totalAddr2isoUSD = await isoUSD.balanceOf(addr2.address);
      await isoUSD.connect(addr2).transfer(addr1.address, totalAddr2isoUSD);
      
      //relax collateral requirements to enable us to take a loan we can then make liquidatable easily
      const sETHMinMargin = ethers.utils.parseEther("1.001");
      const sETHLiqMargin = ethers.utils.parseEther("1.0");
      const sETHInterest5 = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
      await collateralBook.TESTchangeCollateralType(sETH.address, sETHCode, sETHMinMargin, sETHLiqMargin, sETHInterest5, ZERO_ADDRESS, liq_return.mul(2), SYNTH); //fake LIQ_RETURN used for ease of tests

      //repay some of loan so that only partial liquidation is possible
      let loanRepayment = liquidationLoanSize.div(5)
      await isoUSD.connect(addr1).approve(vault.address, loanRepayment)
      await vault.connect(addr1).closeLoan(sETH.address, 0, loanRepayment);
      const totalAddr1isoUSD = await isoUSD.balanceOf(addr1.address);
      await isoUSD.connect(addr1).transfer(addr2.address, totalAddr1isoUSD);

      const beforeisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      const principleBefore = await vault.isoUSDLoaned(sETHaddr, addr1.address)

      const beforeColBalanceVault = await sETH.balanceOf(vault.address);
      expect(beforeColBalanceVault).to.equal(colQuantity);

      const beforeColBalance = await sETH.balanceOf(addr2.address);
      expect(beforeColBalance).to.equal(0);
      ethPriceBN = await vault.priceCollateralToUSD(sETHCode, e18);

      //change collateral parameters to force partial liquidation being possible
      const sETHMinMargin5 = ethers.utils.parseEther("2.0");
      const sETHLiqMargin5 = ethers.utils.parseEther("1.5");
      await collateralBook.TESTchangeCollateralType(sETH.address, sETHCode, sETHMinMargin5, sETHLiqMargin5, sETHInterest5, ZERO_ADDRESS, liq_return.mul(2), SYNTH); //fake LIQ_RETURN used for ease of tests
      const virtualDebtBegin = await vault.isoUSDLoanAndInterest(sETHaddr, addr1.address);
      
      //isoUSD repayment approval and liquidation call
      await isoUSD.connect(addr2).approve(vault.address, beforeisoUSDBalance)
      const tx = await vault.connect(addr2).callLiquidation(addr1.address, sETHaddr)
      
      
      const virtualPriceEnd = await collateralBook.viewVirtualPriceforAsset(sETH.address);
      const realLoanOwed = virtualDebtBegin.mul(virtualPriceEnd).div(e18);
      const liquidateCollateral = await vault.viewLiquidatableAmount(colQuantity, ethPriceBN, realLoanOwed, sETHLiqMargin5)
      const liquidatorPayback = (await vault.priceCollateralToUSD(sETHCode, liquidateCollateral)).mul(base.sub(liquidatorFeeBN)).div(base); 
      
      await expect (tx).to.emit(vault, 'Liquidation').withArgs(addr1.address, addr2.address, liquidatorPayback, sETHCode, liquidateCollateral);  
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      expect(AfterisoUSDBalance).to.closeTo(beforeisoUSDBalance.sub(liquidatorPayback), 1);//rounding errors sometimes, allow +/- 1
      
      const AfterColBalanceVault = await sETH.balanceOf(vault.address);
      expect(AfterColBalanceVault).to.equal(colQuantity.sub(liquidateCollateral));
      
      const AfterColBalance = await sETH.balanceOf(addr2.address);
      expect(AfterColBalance).to.equal(liquidateCollateral);
      //rounding leaves 1 debt, not important as we work in 18dp

      const principle = await vault.isoUSDLoaned(sETHaddr, addr1.address)
      expect(principle).to.be.closeTo(principleBefore.sub(liquidatorPayback),1); //rounding error again
      
      const realDebt = (await vault.isoUSDLoanAndInterest(sETHaddr, addr1.address)).mul(virtualPriceEnd).div(e18);
      const expectedVirtualDebt = virtualDebtBegin.sub(liquidatorPayback.mul(base).div(virtualPriceEnd));
      expect(realDebt).to.be.closeTo(expectedVirtualDebt.mul(virtualPriceEnd).div(e18),2); //varies occasionally due to JS rounding
      
      expect(await vault.collateralPosted(sETHaddr, addr1.address)).to.equal(colQuantity.sub(liquidateCollateral));
      
    });
        
    
    it("Should revert if liquidator lacks isoUSD to repay debt", async function () {
      liq_return = await vault.LIQUIDATION_RETURN();
      const startisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      await isoUSD.connect(addr2).transfer(addr1.address, startisoUSDBalance);

      const beforeisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      expect(beforeisoUSDBalance).to.equal(0);

      const beforeColBalance = await sETH.balanceOf(vault.address);
      expect(beforeColBalance).to.equal(colQuantity);

      const beforeColLiquidatorBalance = await sETH.balanceOf(addr2.address);
      expect(beforeColLiquidatorBalance).to.equal(0);

      //modify minimum collateral ratio to enable liquidation
      const sETHMinMargin4 = ethers.utils.parseEther("8.0");
      const sETHLiqMargin4 = ethers.utils.parseEther("6.0");
      const sETHInterest4 = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
      await collateralBook.TESTchangeCollateralType(sETH.address, sETHCode, sETHMinMargin4, sETHLiqMargin4, sETHInterest4, ZERO_ADDRESS, liq_return, SYNTH); 
      
       //liquidation collateral approval and call
      await isoUSD.connect(addr2).approve(vault.address, startisoUSDBalance)
      await expect(vault.connect(addr2).callLiquidation(addr1.address, sETHaddr)).to.be.revertedWith('ERC20: transfer amount exceeds balance');
    });
       
    
    it("Should fail to liquidate if the market is closed", async function () {
      await suspend_synth(provider, sETHCode);
      await expect(
        vault.connect(addr2).callLiquidation(addr1.address, sETHaddr)
      ).to.be.revertedWith("Synth is suspended. Operation prohibited");

    });

    it("Should fail if system is paused", async function () {
      await vault.pause();
      await expect(
        vault.connect(addr2).callLiquidation(addr1.address, sETHaddr)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should fail to liquidate if the collateral token is unsupported", async function () {
      await expect(
        vault.connect(addr2).callLiquidation(addr1.address, FakeAddr)
      ).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail to liquidate if the collateral is paused in CollateralBook", async function () {
      await collateralBook.pauseCollateralType(sETH.address, sETHCode);
      await expect(
        vault.connect(addr2).callLiquidation(addr1.address, sETH.address)
      ).to.be.revertedWith("Unsupported collateral!");
    });


    it("Should fail to liquidate if the collateral token is not set", async function () {
      await expect(
        vault.connect(addr2).callLiquidation(addr1.address, ZERO_ADDRESS)
      ).to.be.revertedWith("Unsupported collateral!");

    });

    it("Should fail to liquidate if the debtor address is not set", async function () {
      await expect(
        vault.connect(addr2).callLiquidation(ZERO_ADDRESS, sETHaddr)
      ).to.be.revertedWith("Zero address used");

    });

    it("Should fail to liquidate if flagged loan isn't at liquidatable margin level", async function () {
      const loanAmount = ethers.utils.parseEther("100");
      const collateralAmount = ethers.utils.parseEther("1");
      //add a price check here that the collateral is valued greater than required amount for fuzzing?
      await sETH.connect(addr1).transfer(addr2.address, collateralAmount);
      await sETH.connect(addr2).approve(vault.address, collateralAmount);
      await vault.connect(addr2).openLoan(sETHaddr, collateralAmount, loanAmount);
      await expect(
        vault.connect(addr1).callLiquidation(addr2.address, sETHaddr)
      ).to.be.revertedWith("Loan not liquidatable");
    });
    
  });

  


  describe("setDailyMax", function () {
    beforeEach(async function () {
       
    });
    it("Should not allow anyone to call it", async function () {
      await expect( vault.connect(addr2).setDailyMax(12)).to.be.revertedWith("Caller is not an admin"); 
    });
    it("Should succeed when called by owner with values smaller than $100 million", async function () {
      const million = ethers.utils.parseEther("1000000");
      const oldMax = await vault.dailyMax();
      expect( await vault.connect(owner).setDailyMax(million)).to.emit(vault, 'ChangeDailyMax').withArgs(million, oldMax); 
      expect(await vault.dailyMax()).to.equal(million)
      expect( await vault.connect(owner).setDailyMax(0)).to.emit(vault, 'ChangeDailyMax').withArgs(0, million);
      expect(await vault.dailyMax()).to.equal(0)
    });
    it("Should fail with values larger than $100 million", async function () {
      const billion = ethers.utils.parseEther("1000000000");
      await expect(vault.connect(owner).setDailyMax(billion)).to.be.reverted; 
    });       
  
    
  });

  describe("setOpenLoanFee", function () {
    beforeEach(async function () {
       
    });
    it("Should not allow anyone to call it", async function () {
      await expect( vault.connect(addr2).setOpenLoanFee(12)).to.be.revertedWith("Caller is not an admin"); 
    });
    it("Should succeed when called by owner with values smaller than 10**17 (10%)", async function () {
      const newMax = ethers.utils.parseEther("0.01");
      const oldMax = await vault.dailyMax();
      expect( await vault.connect(owner).setOpenLoanFee(newMax)).to.emit(vault, 'changeOpenLoanFee').withArgs(newMax, oldMax); 
      expect(await vault.loanOpenFee()).to.equal(newMax)
      expect( await vault.connect(owner).setOpenLoanFee(0)).to.emit(vault, 'changeOpenLoanFee').withArgs(0, newMax);
      expect(await vault.loanOpenFee()).to.equal(0)
    });
    it("Should fail with values larger than 10**17 (10%)", async function () {
      const wrongMax = ethers.utils.parseEther("0.11");
      await expect(vault.connect(owner).setOpenLoanFee(wrongMax)).to.be.reverted; 
    });       
  
    
  });

  describe("setTreasury", function () {
    it("Should not allow anyone to call it", async function () {
      await expect( vault.connect(addr2).setTreasury()).to.be.revertedWith("Caller is not an admin"); 
    });
    it("Should revert if no treasury change is pending", async function () {
      await expect( vault.connect(owner).setTreasury()).to.be.reverted; 
    });
    it("Should succeed if change is pending and only when timelock has passed", async function () {
      const VAULT_TIME_DELAY = 3*24*60*60 
      old_treasury = await vault.treasury()
      new_treasury = addr2.address
      await vault.connect(owner).proposeTreasury(new_treasury)
      //check set call reverts when timelock has not passed
      await expect( vault.connect(owner).setTreasury()).to.be.reverted; 
      //skip time past timelock deadline
      helpers.timeSkip(VAULT_TIME_DELAY);
      await expect( vault.connect(owner).setTreasury()).to.emit(vault, 'ChangeTreasury').withArgs(old_treasury, new_treasury)
    });       
  
    
  });

  describe("proposeTreasury", function () {
    
    it("Should not allow anyone to call it", async function () {
      const new_treasury = addr2.address
      await expect( vault.connect(addr2).proposeTreasury(new_treasury)).to.be.revertedWith("Caller is not an admin"); 
    });
    it("Should revert if zero address is propose as treasury", async function () {
      await expect( vault.connect(owner).proposeTreasury(ZERO_ADDRESS)).to.be.reverted; 
    });
    it("Should succeed if given valid conditions", async function () {
      const VAULT_TIME_DELAY = 3*24*60*60 
      old_treasury = await vault.treasury()
      const new_treasury = addr2.address
      const tx = await vault.connect(owner).proposeTreasury(new_treasury)
      const block = await ethers.provider.getBlock(tx.blockNumber);
      
      expect(await vault.pendingTreasury()).to.equal(new_treasury)
      expect(await vault.updateTreasuryTimestamp()).to.equal(block.timestamp+VAULT_TIME_DELAY)

    });       
  
    
  });


  describe("Role based access control", function () {
    const TIME_DELAY = 3 * 24 *60 *60 +1 //3 days
    const PAUSER = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PAUSER_ROLE"));
    const ADMIN = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADMIN_ROLE"));
    beforeEach(async function (){
        const tx = await vault.connect(owner).proposeAddRole(addr2.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(addr2.address, PAUSER, owner.address, block.timestamp);

    })

    it("should not set anyone as DEFAULT_ADMIN_ROLE", async function() {
          const default_admin = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("DEFAULT_ADMIN_ROLE"));
          expect( await vault.hasRole(default_admin, owner.address) ).to.equal(false);        
      });

    it("should set deploying address as ADMIN_ROLE and PAUSER_ROLE", async function() {
          expect( await vault.hasRole(ADMIN, owner.address) ).to.equal(true);    
          expect( await vault.hasRole(PAUSER, owner.address) ).to.equal(true);     
      });
  
    it("Should enable admin role addresses to call pauser functions", async function() {
        const tx = await vault.connect(owner).proposeAddRole(addr1.address, ADMIN);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(addr1.address, ADMIN, owner.address, block.timestamp);
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(addr1.address, ADMIN)).to.emit(vault, 'AddRole').withArgs(addr1.address, ADMIN,  owner.address);
        await expect(vault.connect(addr1).pause()).to.emit(vault, 'SystemPaused').withArgs(addr1.address);
        expect( await vault.hasRole(PAUSER, addr1.address) ).to.equal(false);
        expect( await vault.hasRole(ADMIN, addr1.address) ).to.equal(true);
    });

    it("should add a role that works if following correct procedure", async function() {
      helpers.timeSkip(TIME_DELAY);
      await expect(vault.connect(owner).addRole(addr2.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(addr2.address, PAUSER,  owner.address);
      expect( await vault.hasRole(PAUSER, addr2.address) ).to.equal(true);
      const tx = await vault.connect(addr2).pause();
      const block = await ethers.provider.getBlock(tx.blockNumber);
      await expect(tx).to.emit(vault, 'SystemPaused').withArgs(addr2.address);
    });

    it("should block non-role users calling role restricted functions", async function() {
      await expect(vault.connect(addr1).pause()).to.be.revertedWith("Caller is not able to call pause");
    });

    it("should be possible to add, remove then add the same role user again", async function() {
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(addr2.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(addr2.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, addr2.address) ).to.equal(true);

        await expect(vault.connect(owner).removeRole(addr2.address, PAUSER)).to.emit(vault, 'RemoveRole').withArgs(addr2.address,PAUSER, owner.address);
        expect( await vault.hasRole(PAUSER, addr2.address) ).to.equal(false);

        const tx = await vault.connect(owner).proposeAddRole(addr2.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(addr2.address, PAUSER, owner.address, block.timestamp);
        
        helpers.timeSkip(TIME_DELAY);

        await expect(vault.connect(owner).addRole(addr2.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(addr2.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, addr2.address) ).to.equal(true);
    });

    it("should fail to remove a roleless account from a role", async function() {
      await expect(vault.connect(owner).removeRole(addr1.address, PAUSER)).to.be.revertedWith("Address was not already specified role");
        

    });

    it("should fail to add a role if a non-admin tries to complete adding", async function() {
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(addr1).addRole(addr2.address, PAUSER)).to.be.revertedWith("Caller is not an admin");

    });

    it("should fail to add the role if proposed and add roles differ", async function() {
      helpers.timeSkip(TIME_DELAY);
      await expect(vault.connect(owner).addRole(addr2.address, ADMIN)).to.be.revertedWith("Invalid Hash");

  });
    
    it("should fail to queue multiple role adds at the same time", async function() {
        const tx = await vault.connect(owner).proposeAddRole(addr1.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(addr1.address, PAUSER, owner.address, block.timestamp);
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(addr2.address, PAUSER)).to.be.revertedWith("Invalid Hash");
        await expect(vault.connect(owner).addRole(addr1.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(addr1.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, addr2.address) ).to.equal(false);
        expect( await vault.hasRole(PAUSER, addr1.address) ).to.equal(true);

    });

    it("should succeed to add a role if nonce has been incremented (i.e. repeat transaction)", async function() {
        const tx = await vault.connect(owner).proposeAddRole(addr2.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(addr2.address, PAUSER, owner.address, block.timestamp);
        await expect(vault.connect(owner).addRole(addr2.address, PAUSER)).to.be.revertedWith("Not enough time has passed");
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(addr2.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(addr2.address, PAUSER,  owner.address);

    });

    it("should succeed to add multiple role users sequentially with required time delays", async function() {
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(addr2.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(addr2.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, addr2.address) ).to.equal(true);
        const tx = await vault.connect(owner).proposeAddRole(addr1.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(addr1.address, PAUSER, owner.address, block.timestamp);
        expect( await vault.hasRole(PAUSER, addr1.address) ).to.equal(false);
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(addr1.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(addr1.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, addr1.address) ).to.equal(true);
    });

});

});
