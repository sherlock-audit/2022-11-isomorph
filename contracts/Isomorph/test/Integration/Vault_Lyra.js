// We import Chai to use its asserting functions here.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { addresses } = require("../deployedAddresses.js")
const { ABIs } = require("../abi.js")
const { helpers } = require("../testHelpers.js")
const { getMarketDeploys } = require('@lyrafinance/protocol');



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


function timeSkipRequired(totalInterest, threeMinInterest){
  //helper function to automatically determine the amount of time skips needed to achieve the required interest owed
  let decimalThreeMinInterest = threeMinInterest /100000000;
  let powerNeeded = (Math.log(totalInterest) / Math.log(decimalThreeMinInterest));
  let timeSkipinSecs = powerNeeded*180;
  return Math.floor(timeSkipinSecs);
}

async function cycleVirtualPrice(steps, collateral) {
  //helper function that determines how many times it needs to call virtualPrice updates for a collateral then calls updateVirtualPriceSlowly
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

async function updateStaleGreeks(greekCache, liveBoardIDs, account){
  //helper function for updating greeks of live lyra option boards, this prevents errors with other calls.
  for (let i in liveBoardIDs){
    console.log("updating board ", liveBoardIDs[i])
    await greekCache.connect(account).updateBoardCachedGreeks(liveBoardIDs[i])
  }
}

//dumped old set up for Lyra, keep if needed again
async function mockLyraSetup() {
    //lyraLiquidityTokenContract = await ethers.getContractFactory("LiquidityTokens");
    //lyraLiquidityPoolAvalonContract = await ethers.getContractFactory("LiquidityPoolAvalon");
    //lyraLPToken = await lyraLiquidityTokenContract.deploy("LPToken", "LP");
    //lyraLiqPool = await lyraLiquidityPoolAvalonContract.deploy();
    //await lyraLiqPool.init(lyraLPToken.address); 
    //await lyraLPToken.init(lyraLiqPool.address);
    // set up for lyra liquidity pool
    //const lpParams = [1,10,10,0,1000,100000, 100000, 100000, 10000, 100, 100000, 100000];
    //await lyraLiqPool.setLiquidityPoolParameters(lpParams);
        
    //await lyraLiqPool.MOCK_setTotalPoolValueQuote(amountIn); //10 eth
    //await lyraLiqPool.MOCK_mintToUser(addr1.address, amountIn);
}


describe("Integration tests: Vault Lyra contract", function () {
  

  let owner; //0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
  let addr1; //0x70997970c51812dc3a010c7d01b50e0d17dc79c8
  let addr2; //0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc
  let addrs;
  let signer;
  let FakeAddr; //used when we need an unrelated address
  const ZERO_ADDRESS = ethers.constants.AddressZero;
  
  //various keys used for identification of collateral and the minter role
  const testCode = ethers.utils.formatBytes32String("test");
  const lyraCode = ethers.utils.formatBytes32String("LyraLP"); //tester for lyra LP tokens
  const MINTER = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));

  //Use the Lyra Protocol SDK to fetch their addresses
  let lyraMarket = getMarketDeploys('mainnet-ovm', 'sETH');
  const LyraLPaddr = lyraMarket.LiquidityPool.address;
  const LyraGreekCache = lyraMarket.OptionGreekCache.address;
  const LyraPTokenaddr = lyraMarket.LiquidityToken.address;
  const LyraOptionMarket = lyraMarket.OptionMarket.address;
  const LyraLPDoner = addresses.optimism.Lyra_Doner

  //grab the provider endpoint
  const provider = ethers.provider;

  // match the addresses to their smart contracts so we can interact with them
  const lyraLiqPool = new ethers.Contract(LyraLPaddr, ABIs.LyraLP, provider)
  const lyraLPToken = new ethers.Contract(LyraPTokenaddr, ABIs.ERC20, provider)
  const greekCache = new ethers.Contract(LyraGreekCache, ABIs.GreekCache, provider)
  const optionMarket = new ethers.Contract(LyraOptionMarket, ABIs.OptionMarket, provider)
  let liveBoardIDs 

  //consts used for maths or the liquidation system
  const colQuantity = ethers.utils.parseEther('277');
  const liquidatorFee = 0.05; //5%
  const liquidatorFeeBN = ethers.utils.parseEther('0.05'); //5%
  let loanOpenfee = ethers.utils.parseEther('0.01'); //1%
  const loanSizeInisoUSD = 10000000;
  const PartialloanSizeInisoUSD = 7000000;
  //const BASE_FEE = ethers.utils.parseEther('1'); //minimum loan open fee, used to prevent microloans
  const e18 = ethers.utils.parseEther('1');
  const zero = ethers.utils.parseEther('0');
  const base = ethers.utils.parseEther('1'); // 1eth
  const threeMinInterest = 100000180 //119710969;
  let liq_return //grabs LIQUIDATION_RETURN constant after setting up vault contract.

  
  //identifiers for collateral settings
  const SYNTH = 0;
  const LYRA = 1;

  let snapshotId;


  before(async function () {
        // Get the ContractFactory and Signers here 
        this.timeout(1000000);
        const provider = ethers.provider;
        [owner, addr1, addr2, ...addrs] = await ethers.getSigners();
        FakeAddr = addrs[0].address;
        console.log('Block Index at start ', await provider.getBlockNumber());
        //console.log("PROVIDER ", provider);  
        let donerAmount = ethers.utils.parseEther('1000000'); //$1million sUSD;
        
        //borrow collateral tokens from doner addresses 
        deathSeedContract = await ethers.getContractFactory("TESTdeathSeed");
        deathSeed = await deathSeedContract.deploy()
        deathSeed.terminate(LyraLPDoner, {"value" : e18}); //self destruct giving ETH to SC without receive.
        impersonateForToken(provider, addr1, lyraLPToken, LyraLPDoner, donerAmount)

        contract = await ethers.getContractFactory("TEST_Vault_Lyra");
        isoUSDcontract = await ethers.getContractFactory("isoUSDToken");

        collateralContract = await ethers.getContractFactory("TESTCollateralBook");
        

        isoUSD = await isoUSDcontract.deploy();
        
        treasury = addrs[1]
        collateralBook = await collateralContract.deploy(); 
        vault = await contract.deploy(isoUSD.address, treasury.address, collateralBook.address);
        await collateralBook.addVaultAddress(vault.address, LYRA);

        const amountIn= ethers.utils.parseEther('1000');
        await isoUSD.proposeAddRole(vault.address, MINTER);
      
        //helpers.timeSkip(3*24*60*60+1) //3 days 1s required delay
        helpers.timeSkip(4) //4s for testing purposes otherwise synthetix price feeds become stale
        
        await isoUSD.addRole(vault.address, MINTER);
        //set up CollateralBook Lyra LP Collateral
        const MinMargin = ethers.utils.parseEther("1.8");
        const LiqMargin = ethers.utils.parseEther("1.053");
        const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
        await collateralBook.addCollateralType(lyraLPToken.address, lyraCode, MinMargin, LiqMargin, Interest, LYRA, lyraLiqPool.address);
        liveBoardIDs = await optionMarket.getLiveBoards();
        //update stale greek caches
        console.log("Updating stale lyra board Greeks.")
        console.log("Please wait this may take some time...")
        for (let i in liveBoardIDs){
          //this is very slow, comment out if not needed
          await greekCache.connect(owner).updateBoardCachedGreeks(liveBoardIDs[i], {gasLimit: 9000000})
        }
        //console.log("Feedback post ", await lyraLiqPool.getTokenPriceWithCheck())
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
    it("Should deploy the right constructor addresses", async function (){
      
      expect( await vault.treasury()).to.equal(treasury.address);
      expect( await vault.isoUSD()).to.equal(isoUSD.address);
      expect( await vault.collateralBook()).to.equal(collateralBook.address);
     
    });
  });
  

  
   
  describe("OpenLoans", function () {
      const collateralUsed = ethers.utils.parseEther('1000');
      const loanTaken = ethers.utils.parseEther('500');

    it("Should mint user isoUSD if given valid conditions at time zero and emit OpenLoan event", async function () {
      this.timeout(100000);
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address)
      const beforeCollateralAddr1Balance = await lyraLPToken.balanceOf(addr1.address)
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, lyraCode,collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
      const afterCollateralAddr1Balance = await lyraLPToken.balanceOf(addr1.address)
      expect(afterCollateralAddr1Balance).to.equal(beforeCollateralAddr1Balance.sub(collateralUsed));
      
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      expect(principle).to.equal(loanTaken)


      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      const loanAndInterest = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)
      //at time zero this should match principle
      expect(loanAndInterest).to.equal(loanTaken.mul(base).div(virtualPrice))
    });

    //slow
    it("Should function for Lyra collateral only once Lyra Circuit Breaker time passes", async function () {
      this.timeout(350000);

      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      const beforeAddr1LyraBalance = await lyraLPToken.balanceOf(addr1.address);
      //grab a timestamp for setting up the circuit breaker time
      const beginBlock = await ethers.provider.getBlock(beforeAddr1LyraBalance.blockNumber);
      const startTime = beginBlock.timestamp;
      
      //trigger Lyra CB here by overwriting CBTimestamp in slot 33 of LiquidityPool storage
      const timestamp = ethers.utils.hexZeroPad(ethers.utils.hexlify(startTime + 200), 32)
      await network.provider.send("hardhat_setStorageAt", [
        "0x5Db73886c4730dBF3C562ebf8044E19E8C93843e",
        "0x21",
        timestamp, //100 seconds into the future, we don't want other pricefeeds to go stale
      ]);
      //set up approval and also grab timestamp to calc time delta from later
      tx = await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const currentTime = block.timestamp;

      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken)).to.be.revertedWith("Lyra Circuit Breakers active, can't trade");
      const circuitBreakerTime = await lyraLiqPool.CBTimestamp()
      
      helpers.timeSkip(circuitBreakerTime - currentTime)

      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, lyraCode,collateralUsed );
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
      const afterAddr1LyraBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(afterAddr1LyraBalance).to.equal(beforeAddr1LyraBalance.sub(collateralUsed));
      
    });

    it("Should function after pausing and unpausing system", async function () {
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      await vault.pause();
      await vault.unpause();

      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, lyraCode,collateralUsed );
      
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

      expect(await collateralBook.collateralPaused(lyraLPToken.address)).to.equal(false);
      
      await collateralBook.pauseCollateralType(lyraLPToken.address, lyraCode);
      
      expect(await collateralBook.collateralPaused(lyraLPToken.address)).to.equal(true);
      
      await collateralBook.unpauseCollateralType(lyraLPToken.address, lyraCode);
      
      expect(await collateralBook.collateralPaused(lyraLPToken.address)).to.equal(false);
      
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, lyraCode, collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
    });
  
    it("Should openLoan and record debt corrected after time elasped in system", async function () {   
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      const timestep = 200;
      helpers.timeSkip(timestep);

      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      expect(virtualPrice).to.equal(base);

      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, lyraCode, collateralUsed );
      
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
      const virtualDebtBalance = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address);
      let virtualPriceUpdate = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address); 
      const debt = loanTaken.mul(base).div(virtualPriceUpdate);
      expect(virtualDebtBalance).to.equal(debt);

      //principle should be unaffected by time changing
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      expect(principle).to.equal(loanTaken)
      
    });

     // SLOW TEST
     it("Should correctly apply interest accrued after a long time", async function () {
      this.timeout(100000);
      interestToAccrue = 1.375 // i.e. 37.5%
      interestToAccrueBN = ethers.utils.parseEther('1.375');
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, lyraCode,collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
      //calculate the number of steps needed to generate the interest specified
      let steps = timeSkipRequired(interestToAccrue,threeMinInterest)
      year_in_seconds = 60*60*24*365
      expect(steps).to.be.closeTo(year_in_seconds, Math.floor(year_in_seconds*0.01) ) //expect it to be close to 1 year in time
      await cycleVirtualPrice(steps, lyraLPToken)

      const virtualDebtBalance = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address);
      let virtualPriceUpdate = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address); 
      const debt = virtualDebtBalance.mul(virtualPriceUpdate).div(base)
      //allow an error of 0.1% to account for round down in tests from cycleVirtualPrice
      error = ethers.BigNumber.from(loanTaken.mul(interestToAccrueBN).div(1000).div(base))
      expectedLoan = loanTaken.mul(interestToAccrueBN).div(base)
      expect(debt).to.be.closeTo(expectedLoan, error);

      //principle should be unaffected by time changing
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      expect(principle).to.equal(loanTaken)

      
    });

    it("Should be possible to increase existing loan and emit OpenOrIncreaseLoan event", async function () {
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      smallerLoanTaken = ethers.utils.parseEther('200');
      await vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, smallerLoanTaken);
      
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      expect(principle).to.equal(smallerLoanTaken)

      let AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(smallerLoanTaken.mul(base.sub(loanOpenfee)).div(base))
      
      let AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(smallerLoanTaken.mul(loanOpenfee).div(base));

      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const loanIncrease = ethers.utils.parseEther('300');
      
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, 0, loanIncrease)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanIncrease, lyraCode, 0);
      
      const principleAfter = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      expect(principleAfter).to.equal(principle.add(loanIncrease))

      AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const isoUSDafterIncrease = beforeAddr1Balance.add((loanIncrease.mul(base.sub(loanOpenfee))).div(base))
      expect(AfterAddr1Balance).to.equal(isoUSDafterIncrease);
      
      AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const isoUSDafterTreasury = (loanIncrease.mul(loanOpenfee).div(base)).add(beforeTreasuryBalance);
      expect(AfterTreasuryBalance).to.equal(isoUSDafterTreasury);
      
    });
    
    it("Should fail if daily max Loan amount exceeded", async function () {
      await vault.connect(owner).setDailyMax(1000);
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await expect(
        vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken)
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
        vault.connect(addr2).openLoan(lyraLPToken.address, collateralUsed, loanTaken)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should fail if collateral is paused in CollateralBook", async function () {
      await collateralBook.pauseCollateralType(lyraLPToken.address, lyraCode);
      await expect(
        vault.connect(addr2).openLoan(lyraLPToken.address, collateralUsed, loanTaken)
      ).to.be.revertedWith("Unsupported collateral!");
    });


    it("Should fail if sender doesn’t have enough collateral tokens", async function () {
      const initialAddr2Balance = await isoUSD.balanceOf(addr2.address);
      expect(initialAddr2Balance).to.equal(0);
      await lyraLPToken.connect(addr2).approve(vault.address, collateralUsed);
      await expect(
        vault.connect(addr2).openLoan(lyraLPToken.address, collateralUsed, loanTaken)
      ).to.be.revertedWith('User lacks collateral quantity!');
    });

    it("Should fail if sender requests too much isoUSD", async function () {
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await expect(
        vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken.mul(4))
      ).to.be.revertedWith("Minimum margin not met!");
    });

    it("Should fail if sender posts no collateral ", async function () {
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await expect(
        vault.connect(addr1).openLoan(lyraLPToken.address, 0, loanTaken)
      ).to.be.revertedWith("Minimum margin not met!"); 

    });

    it("Should revert if vault isn't an approved token spender ", async function () {
      await lyraLPToken.connect(addr1).transfer(addr2.address, collateralUsed)
      await expect(
        vault.connect(addr2).openLoan(lyraLPToken.address, collateralUsed, loanTaken)
      ).to.be.revertedWith("ERC20: transfer amount exceeds allowance"); 

    });
    
    
  });
  
  
  describe("Increase existing loan by openLoan ", function () {
    const collateralUsed = ethers.utils.parseEther('1000');
    const loanTaken = ethers.utils.parseEther('200');

    beforeEach(async function () {
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken);
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(loanTaken.mul(base.sub(loanOpenfee)).div(base))

      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
    });

    it("Should mint user isoUSD if possible and emit OpenLoan event", async function () {
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const loanIncrease = ethers.utils.parseEther('300');
      
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, 0, loanIncrease)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanIncrease, lyraCode, 0);
      
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanIncrease.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(beforeTreasuryBalance.add(loanIncrease.mul(loanOpenfee).div(base))); 
    });

    //SLOW TEST
    it("Should still increase loan after accrued interest if possible", async function () {
      //because the Greeks can't update after very large time periods we use a hack here to set the virtualPrice
      let initialVirtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      await vault.TESTalterVirtualPrice(lyraLPToken.address, initialVirtualPrice.mul(1010).div(1000))
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      //we request a loan that places us slightly below the maximum loan allowed
      const loanIncrease = ethers.utils.parseEther('353');
      liveBoardIDs = await optionMarket.getLiveBoards();
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, 0,loanIncrease)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanIncrease, lyraCode, 0);
      const AfterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanIncrease.mul(base.sub(loanOpenfee))).div(base)))
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(beforeTreasuryBalance.add(loanIncrease.mul(loanOpenfee).div(base))); 
      
    });

    it("Should only not update virtualPrice if called multiple times within 3 minutes", async function () {
      const minimumLoan = ethers.utils.parseEther('100');
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);

      let tx = await vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, minimumLoan)
      let virtualPrice_1 = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      
      let tx_2 = await vault.connect(addr1).openLoan(lyraLPToken.address, 0, minimumLoan)
      let virtualPrice_2 = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);

      //check timestamps are within 3 minutes of each other
      const block_1 = await ethers.provider.getBlock(tx.blockNumber);
      const block_2 = await ethers.provider.getBlock(tx_2.blockNumber);
      const THREE_MINS = 3 *60
      expect(block_1.timestamp).to.be.closeTo(block_2.timestamp, THREE_MINS)

      //if we are within 3 minutes both virtual prices should be the same
      expect(virtualPrice_1).to.equal(virtualPrice_2)
    });

    it("Should only not update another collateral's virtualPrice if called", async function () {
      const MinMargin = ethers.utils.parseEther("1.8");
      const LiqMargin = ethers.utils.parseEther("1.053");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      await collateralBook.addCollateralType(FakeAddr, lyraCode, MinMargin, LiqMargin, Interest, LYRA, lyraLiqPool.address);

      const minimumLoan = ethers.utils.parseEther('100'); 
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);

      let virtualPrice_other_asset = await collateralBook.viewVirtualPriceforAsset(FakeAddr);

      await vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, minimumLoan)
      
      let virtualPrice_other_asset_after = await collateralBook.viewVirtualPriceforAsset(FakeAddr);
      
      //if we are within 3 minutes both virtual prices should be the same
      expect(virtualPrice_other_asset).to.equal(virtualPrice_other_asset_after)
    });

    //SLOW TEST
    it("Should fail to increase debt if interest accrued is too high", async function () {
      //because the Greeks can't update after very large time periods we use a hack here to set the virtualPrice
      let initialVirtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      await vault.TESTalterVirtualPrice(lyraLPToken.address, initialVirtualPrice.mul(1050).div(1000)) //5%

      const MinMargin = ethers.utils.parseEther("1.8");

      let currentPrice = await vault.priceCollateralToUSD(lyraCode,base)
      let currentCollateralValue = collateralUsed.mul(currentPrice).div(base)
      let maxLoanPossible = currentCollateralValue.mul(base).div(MinMargin)
      let maxLoanIncrease = maxLoanPossible.sub(loanTaken)
      //we request a loan that places us slightly over the maximum loan allowed
      const loanIncrease = maxLoanIncrease.mul(102).div(100)
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address,0, loanIncrease)).to.be.revertedWith("Minimum margin not met!");
      
    });

    it("Should fail if the user has no existing loan", async function () {
      
      const loanIncrease = ethers.utils.parseEther('300');
      await expect(vault.connect(addr2).openLoan(lyraLPToken.address,0, loanIncrease)).to.be.revertedWith("Minimum margin not met!");
      
    });
    
    it("Should fail if daily max Loan amount exceeded", async function () {

      const loanIncrease = ethers.utils.parseEther('300');
      await vault.setDailyMax(1000);
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, 0,loanIncrease)).to.be.revertedWith("Try again tomorrow loan opening limit hit");
    });
    
    it("Should fail if using unsupported collateral token", async function () {

      const loanIncrease = ethers.utils.parseEther('300');
      await expect(vault.connect(addr1).openLoan(FakeAddr,0, loanIncrease)).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail if sender requests too much isoUSD", async function () {

      const loanIncrease = ethers.utils.parseEther('3000');
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, 0, loanIncrease)).to.be.revertedWith("Minimum margin not met!");
    });
    
    
  });
  

   
  describe("increaseCollateralAmount", function () {
    const totalCollateralUsing = ethers.utils.parseEther('1000');
    const collateralUsed = ethers.utils.parseEther('900');
    const loanTaken = ethers.utils.parseEther('200');
    beforeEach(async function () {
      
      await lyraLPToken.connect(addr1).approve(vault.address, totalCollateralUsing);
      await vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken);
      const afterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(afterAddr1Balance).to.equal(loanTaken.mul(base.sub(loanOpenfee)).div(base))
      const afterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(afterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
    });

    it("Should increase user loan collateral on existing loan and emit IncreaseCollateral event", async function () {
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const beforeAddr1Collateral = await lyraLPToken.balanceOf(addr1.address);
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
      const principleBefore = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      
      await expect(vault.connect(addr1).increaseCollateralAmount(lyraLPToken.address, collateralAdded)).to.emit(vault, 'IncreaseCollateral').withArgs(addr1.address, lyraCode, collateralAdded );
      
      //recorded loan should not have changed
      const principleAfter = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      expect(principleAfter).to.equal(principleBefore)

      //loan should not have increased
      const afterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(afterAddr1Balance).to.equal(beforeAddr1Balance);
      
      //fees earnt by treasury should not have increased
      const afterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(afterTreasuryBalance).to.equal(beforeTreasuryBalance);
      
      const afterAddr1Collateral = await lyraLPToken.balanceOf(addr1.address);
      expect(afterAddr1Collateral).to.equal(beforeAddr1Collateral.sub(collateralAdded));
      
    });

    it("Should function after pausing and unpausing system", async function () {
      
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      const beforeAddr1Collateral = await lyraLPToken.balanceOf(addr1.address);
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
     
      await vault.pause();
      await vault.unpause();
      await expect(vault.connect(addr1).increaseCollateralAmount(lyraLPToken.address, collateralAdded)).to.emit(vault, 'IncreaseCollateral').withArgs(addr1.address, lyraCode, collateralAdded );
      
      const afterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(afterAddr1Balance).to.equal(beforeAddr1Balance);

      const afterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(afterTreasuryBalance).to.equal(beforeTreasuryBalance);

      const afterAddr1Collateral = await lyraLPToken.balanceOf(addr1.address);
      expect(afterAddr1Collateral).to.equal(beforeAddr1Collateral.sub(collateralAdded));
      
    });

    //slow
    it("Should function for Lyra collateral only once Lyra Circuit Breaker time passes", async function () {
      this.timeout(350000);
      //set up an initial loan using this collateral so increaseCollateral doesn't revert
      //set up approval and also grab timestamp to calc time delta from later
      tx = await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed.mul(2));
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const currentTime = block.timestamp;
    
      await vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken);

      const beforeAddr1Collateral = await lyraLPToken.balanceOf(addr1.address);
      const beforeAddr1Balance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);

      //grab beginning timestamp from nearby transaction
      const beginBlock = await ethers.provider.getBlock(beforeTreasuryBalance.blockNumber);
      const startTime = beginBlock.timestamp;
      //trigger Lyra CB here by overwriting CBTimestamp in slot 33 of LiquidityPool storage
      const timestamp = ethers.utils.hexZeroPad(ethers.utils.hexlify(startTime + 100), 32)
      await network.provider.send("hardhat_setStorageAt", [
        "0x5Db73886c4730dBF3C562ebf8044E19E8C93843e",
        "0x21",
        timestamp, //10 seconds into the future, we don't want other pricefeeds to go stale
      ]);
      const collateralAdded = ethers.utils.parseEther('300');
      await expect(vault.connect(addr1).increaseCollateralAmount(lyraLPToken.address, collateralAdded)).to.revertedWith("Lyra Circuit Breakers active, can't trade");
      const circuitBreakerTime = await lyraLiqPool.CBTimestamp()
      
      helpers.timeSkip(circuitBreakerTime - currentTime)

      await expect(vault.connect(addr1).increaseCollateralAmount(lyraLPToken.address, collateralAdded)).to.emit(vault, 'IncreaseCollateral').withArgs(addr1.address, lyraCode, collateralAdded );
      const afterAddr1Balance = await isoUSD.balanceOf(addr1.address);
      expect(afterAddr1Balance).to.equal(beforeAddr1Balance);

      const afterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(afterTreasuryBalance).to.equal(beforeTreasuryBalance);

      const afterAddr1Collateral = await lyraLPToken.balanceOf(addr1.address);
      expect(afterAddr1Collateral).to.equal(beforeAddr1Collateral.sub(collateralAdded));
      
    });

    it("Should fail if accrued interest means debt is still too large", async function () {
      const loanIncrease = ethers.utils.parseEther('300');
      await vault.connect(addr1).openLoan(lyraLPToken.address, 0, loanIncrease);
      //alter liquidationMargin level to make it close to openingMargin level to make situation much easier to setup
      const lyraLPTokenMinMargin = ethers.utils.parseEther("1.8");
      const lyraLPTokenLiqMargin = ethers.utils.parseEther("1.79");
      const lyraLPTokenInterest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
  
      
      await collateralBook.queueCollateralChange(lyraLPToken.address, lyraCode, lyraLPTokenMinMargin, lyraLPTokenLiqMargin, lyraLPTokenInterest, LYRA, lyraLiqPool.address);
      const timeToSkip = await collateralBook.CHANGE_COLLATERAL_DELAY()
      await helpers.timeSkip(timeToSkip.toNumber());
      await collateralBook.changeCollateralType();
      
      //because the Greeks can't update after very large time periods we use a hack here to set the virtualPrice
      let initialVirtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      await vault.TESTalterVirtualPrice(lyraLPToken.address, initialVirtualPrice.mul(1050).div(1000)) //5%
      //try to add a small amount of collateral to the loan
      const collateralUsed = ethers.utils.parseEther('2');
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).increaseCollateralAmount(lyraLPToken.address, collateralUsed)).to.be.revertedWith("Liquidation margin not met!");
      
    });
    
    
    it("Should fail if using unsupported collateral token", async function () {
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
      await expect(vault.connect(addr1).increaseCollateralAmount(FakeAddr, collateralAdded)).to.be.revertedWith("Unsupported collateral!");
      
    });

    it("Should fail if vault paused", async function () {
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
      await vault.pause();
      await expect(vault.connect(addr1).increaseCollateralAmount(lyraLPToken.address, collateralAdded)).to.be.revertedWith("Pausable: paused");
      
      
    });

    it("Should fail if collateral is paused in CollateralBook", async function () {
      const collateralAdded = totalCollateralUsing.sub(collateralUsed)
      await collateralBook.pauseCollateralType(lyraLPToken.address, lyraCode);
      await expect(vault.connect(addr1).increaseCollateralAmount(lyraLPToken.address, collateralAdded)).to.be.revertedWith("Unsupported collateral!");
      
    });


    it("Should fail if sender doesn’t have enough collateral tokens", async function () {
      const beforeAddr1Balance = await lyraLPToken.balanceOf(addr1.address);
      const collateralUsed = beforeAddr1Balance.add(1);
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      await expect(vault.connect(addr1).increaseCollateralAmount(lyraLPToken.address, collateralUsed)).to.be.revertedWith("User lacks collateral amount");
    });

    
    it("Should fail if sender posts no collateral ", async function () {
      await expect(vault.connect(addr1).increaseCollateralAmount(lyraLPToken.address, 0)).to.be.revertedWith("Zero amount");
    });

    it("Should fail if sender never opened loan originally ", async function () {
      const collateralAdded = ethers.utils.parseEther('100');
      await expect(vault.connect(addr2).increaseCollateralAmount(lyraLPToken.address, collateralAdded)).to.be.revertedWith("No existing collateral!");
    });
    
    
  });
  describe("CloseLoans", function () {
    collateralAmount = ethers.utils.parseEther("1000");
    loanAmount = collateralAmount.div(2)

    beforeEach(async function () {
      
      await lyraLPToken.connect(addr1).approve(vault.address, collateralAmount);
      await vault.connect(addr1).openLoan(lyraLPToken.address, collateralAmount, loanAmount);
      
      //then we make a small loan for the purposes of nullifying the impact
      // of the openLoanFee and time elapsed interest due.
      await lyraLPToken.connect(addr1).transfer(addr2.address, collateralAmount);
      await lyraLPToken.connect(addr2).approve(vault.address, collateralAmount);
      await vault.connect(addr2).openLoan(lyraLPToken.address, collateralAmount, loanAmount);
      
      const isoUSDamount = await isoUSD.balanceOf(addr2.address);
      await isoUSD.connect(addr2).transfer(addr1.address, isoUSDamount);

  
    });

    it("Should return user isoUSD if valid conditions are met and emit ClosedLoan event", async function () {
    
      let realDebt = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18);

      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      const beforeColBalance = await lyraLPToken.balanceOf(addr1.address);
      const requestedCollateral = collateralAmount;
      
      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect (vault.connect(addr1).closeLoan(lyraLPToken.address, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, lyraCode, requestedCollateral);
      
      //a fully paid loan should repay all principle except dust
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      let error = 1
      expect(principle).to.be.closeTo(zero, error)

      //a fully repaid loan should repay all interest also (except dust)
      const totalLoan = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)
      expect(totalLoan).to.be.closeTo(zero, error)

      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));

      //check the fees accumulated in the treasury
      const TreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      let TreasuryisoUSDDifference = TreasuryisoUSDBalance.sub(beforeTreasuryisoUSDBalance)
      let expectedFees = valueClosing.sub(loanAmount)
      expect(TreasuryisoUSDDifference).to.be.closeTo(expectedFees, error) 
      
      const AfterColBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));
    });

    it("Should return user isoUSD if valid conditions are met and emit ClosedLoan event after interest has accrued", async function () {
      //because the Greeks can't update after very large time periods we use a hack here to set the virtualPrice
      let initialVirtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      await vault.TESTalterVirtualPrice(lyraLPToken.address, initialVirtualPrice.mul(1011).div(1000))
      let realDebt = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18)

      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      const beforeColBalance = await lyraLPToken.balanceOf(addr1.address);
      const requestedCollateral = collateralAmount;

      const totalLoanBefore = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)
      const principleBefore = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      const isoUSDTreasuryBefore = await isoUSD.balanceOf(treasury.address);
      
      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect (vault.connect(addr1).closeLoan(lyraLPToken.address, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan')
      
      //a fully paid loan should repay all principle
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      let error = 1
      expect(principle).to.be.closeTo(zero, error)

      //a fully repaid loan should repay all interest also
      const totalLoan = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)
      expect(totalLoan).to.be.closeTo(zero, error)

      //expect all the repaid loan to be removed from the user
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));

      //check the fees accumulated in the treasury
      const TreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      let TreasuryisoUSDDifference = TreasuryisoUSDBalance.sub(beforeTreasuryisoUSDBalance)
      let expectedFees = valueClosing.sub(loanAmount)
      expect(TreasuryisoUSDDifference).to.equal(expectedFees)
      
      const AfterColBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));
    });

    it("Should return full user isoUSD if remaining debt is less than $0.001", async function () {
      
      let realDebt = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      const valueClosing = (realDebt.mul(virtualPrice).div(e18)).sub(100);
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeColBalance = await lyraLPToken.balanceOf(addr1.address);
      const principleBefore = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      const requestedCollateral = collateralAmount;

      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect (vault.connect(addr1).closeLoan(lyraLPToken.address, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, lyraCode, requestedCollateral);
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));
      
      const AfterColBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));

      //a fully paid loan should repay nearly all principle leaving only dust behind
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      let error = principleBefore.div(100000) //0.001%
      expect(principle).to.be.closeTo(zero, error)

      //a fully repaid loan should repay all interest also, minus dust again 
      const totalLoan = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)
      expect(totalLoan).to.be.closeTo(zero, error)
    });

    it("Should allow reducing margin ratio if in excess by drawing out collateral", async function () {
      let realDebt = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18);
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeColBalance = await lyraLPToken.balanceOf(addr1.address);

      const requestedCollateral = collateralAmount

      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect(vault.connect(addr1).closeLoan(lyraLPToken.address, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, lyraCode, requestedCollateral);
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      let leftoverisoUSD = beforeisoUSDBalance.sub(valueClosing)
      expect(AfterisoUSDBalance).to.equal(leftoverisoUSD);

      const AfterColBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));

      //Now a neutral position is acquired, reopen loan with excess margin
      collateralPaid = ethers.utils.parseEther("1000");
      await lyraLPToken.connect(addr1).approve(vault.address, collateralPaid);
      const loanTaking = collateralPaid.div(5)
      await vault.connect(addr1).openLoan(lyraLPToken.address, collateralPaid, loanTaking );
      
      const middleisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(middleisoUSDBalance).to.equal(leftoverisoUSD.add(loanTaking.mul(base.sub(loanOpenfee)).div(base)));
      
      const middleColBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(middleColBalance).to.equal(AfterColBalance.sub(collateralPaid));

      const principleBefore = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)
      
      const requestedCollateral2 = ethers.utils.parseEther("500");
      await expect(vault.connect(addr1).closeLoan(lyraLPToken.address, requestedCollateral2, 0)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, 0, lyraCode, requestedCollateral2);
      
      //if no loan is repaid then the principle owed should stay the same 
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      expect(principle).to.equal(principleBefore)

      //if no loan is repaid then the loan and interest owed should stay the same 
      const totalLoan = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)
      expect(totalLoan).to.equal(totalLoanBefore)

      const finalisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(finalisoUSDBalance).to.equal(leftoverisoUSD.add(loanTaking.mul(base.sub(loanOpenfee)).div(base)));
      
      const finalColBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(finalColBalance).to.equal(middleColBalance.add(requestedCollateral2));
    });

    it("Should allow partial closure of loan if valid conditions are met", async function () {
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeTreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      const beforeColBalance = await lyraLPToken.balanceOf(addr1.address);

      const valueClosing = ethers.utils.parseEther("250");
      const requestedCollateral = ethers.utils.parseEther("500");

      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect(vault.connect(addr1).closeLoan(lyraLPToken.address, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, lyraCode, requestedCollateral);
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing))

      //as we have paid no interest there should be no fee paid to the treasury yet
      const TreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      expect(TreasuryisoUSDBalance).to.equal(beforeTreasuryisoUSDBalance)

      const AfterColBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));
    });

    it("Should allow partial closure of loan with no collateral repaid to user", async function () {
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeColBalance = await lyraLPToken.balanceOf(addr1.address);
      const valueClosing = ethers.utils.parseEther("250");
      const requestedCollateral = 0;
      const principleBefore = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)


      await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect(vault.connect(addr1).closeLoan(lyraLPToken.address, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, lyraCode, requestedCollateral);
      
      //the principle should partial decrease 
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      expect(principle).to.equal(principleBefore.sub(valueClosing))

      //no interest is paid but the partial principle decrease should be reflected
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      const totalLoan = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)
      const expectedTotalLoan = totalLoanBefore.sub(valueClosing.mul(base).div(virtualPrice))
      expect(totalLoan).to.equal(expectedTotalLoan)

      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing))

      const AfterColBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));
    });

    //slow
    it("Should function for Lyra collateral only once Lyra Circuit Breaker time passes", async function () {
      this.timeout(350000);
      const collateralUsed = ethers.utils.parseEther("1000");
      const loanTaken = ethers.utils.parseEther("300");
      await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      
      //we check the event here otherwise reverts are silent and don't break the execution chain.
      await expect(vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken)).to.emit(vault, 'OpenOrIncreaseLoan').withArgs(addr1.address, loanTaken, lyraCode,collateralUsed );
      
      let realDebt = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address);
      expect(realDebt.gt(0)).to.equal(true);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
  
      const valueClosing = realDebt.mul(virtualPrice).div(e18);
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      const beforeColBalance = await lyraLPToken.balanceOf(addr1.address);
      const requestedCollateral = collateralUsed;

      //grab start time from nearby transaction
      const beginBlock = await ethers.provider.getBlock(beforeColBalance.blockNumber);
      const startTime = beginBlock.timestamp;
      //trigger Lyra CB here by overwriting CBTimestamp in slot 33 of LiquidityPool storage
      const timestamp = ethers.utils.hexZeroPad(ethers.utils.hexlify(startTime + 100), 32)
      await network.provider.send("hardhat_setStorageAt", [
        "0x5Db73886c4730dBF3C562ebf8044E19E8C93843e",
        "0x21",
        timestamp, //10 seconds into the future, we don't want other pricefeeds to go stale
      ]);

      //first close fails
      tx = await isoUSD.connect(addr1).approve(vault.address, valueClosing);
      await expect (vault.connect(addr1).closeLoan(lyraLPToken.address, requestedCollateral, valueClosing)).to.revertedWith("Lyra Circuit Breakers active, can't trade");
      //grab the timestamp so we know how far we need to go ahead in time to clear the circuit breaker
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const currentTime = block.timestamp;
      const circuitBreakerTime = await lyraLiqPool.CBTimestamp()
      helpers.timeSkip(circuitBreakerTime - currentTime)

      await expect (vault.connect(addr1).closeLoan(lyraLPToken.address, requestedCollateral, valueClosing)).to.emit(vault, 'ClosedLoan').withArgs(addr1.address, valueClosing, lyraCode, requestedCollateral);
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr1.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));
      
      const AfterColBalance = await lyraLPToken.balanceOf(addr1.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(requestedCollateral));
    });
    

    it("Should fail to close if the contract is paused", async function () {
      await vault.pause();
      await expect(
        vault.connect(addr1).closeLoan(lyraLPToken.address, collateralAmount, loanAmount)
      ).to.be.revertedWith("Pausable: paused");

    });

    it("Should fail to close if collateral is paused in CollateralBook", async function () {
      await collateralBook.pauseCollateralType(lyraLPToken.address, lyraCode);
      await expect(
        vault.connect(addr1).closeLoan(lyraLPToken.address, collateralAmount, loanAmount)
      ).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail to close if an invalid collateral is used", async function () {
      await expect(
        vault.connect(addr1).closeLoan(FakeAddr, collateralAmount, loanAmount)
      ).to.be.revertedWith("Unsupported collateral!");

    });

    it("Should fail to close if user asks for more collateral than originally posted", async function () {
      await expect(
        vault.connect(addr1).closeLoan(lyraLPToken.address, collateralAmount.add(1), loanAmount)
      ).to.be.revertedWith("User never posted this much collateral!");

    });

    it("Should fail to close if user has insufficient isoUSD", async function () {
      const isoUSDAmount = await isoUSD.balanceOf(addr1.address);
      await isoUSD.connect(addr1).transfer(addr2.address, isoUSDAmount);
  
      await expect(
        vault.connect(addr1).closeLoan(lyraLPToken.address, collateralAmount, loanAmount)
      ).to.be.revertedWith("Insufficient user isoUSD balance!");
    });

    it("Should fail to close if user tries to return more isoUSD than borrowed originally", async function () {
      //take another loan to get more isoUSD to send to addr1
      await lyraLPToken.connect(addr1).transfer(addr2.address, collateralAmount);
      await lyraLPToken.connect(addr2).approve(vault.address, collateralAmount);
      await vault.connect(addr2).openLoan(lyraLPToken.address, collateralAmount, loanAmount);
      const isoUSDAmount = await isoUSD.balanceOf(addr2.address);
      await isoUSD.connect(addr2).transfer(addr1.address, isoUSDAmount );

      await expect(
        //try to repay loan plus a small amount
        vault.connect(addr1).closeLoan(lyraLPToken.address, collateralAmount, loanAmount.mul(11).div(10))
      ).to.be.revertedWith("Trying to return more isoUSD than borrowed!");
    });

    it("Should fail to close if partial loan closure results in an undercollateralized loan", async function () {
      await lyraLPToken.connect(addr1).transfer(addr2.address, collateralAmount);
      await lyraLPToken.connect(addr2).approve(vault.address, collateralAmount);
      await vault.connect(addr2).openLoan(lyraLPToken.address, collateralAmount, collateralAmount.div(2));

      //attempt to take back all collateral repaying nothing
      await expect(
        vault.connect(addr2).closeLoan(lyraLPToken.address, collateralAmount, 0)
      ).to.be.revertedWith("Remaining debt fails to meet minimum margin!");
      //attempt to take back all collateral repaying some of loan
      await expect(
        vault.connect(addr2).closeLoan(lyraLPToken.address, collateralAmount, collateralAmount.div(3))
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
      let donerAmount2 = ethers.utils.parseEther('1000'); //10 lyraLPToken;
      await lyraLPToken.connect(addr1).transfer(addr2.address, donerAmount2)
      await lyraLPToken.connect(addr1).approve(vault.address, donerAmount2);
      let divider = 1000;
      let numerator = 1001;
      
      const MinMargin2 = ethers.utils.parseEther((numerator/divider).toString(10), "ether")
      const LiqMargin2 = ethers.utils.parseEther("1.0");
      const Interest2 = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
      
      await collateralBook.TESTchangeCollateralType(
        lyraLPToken.address, 
        lyraCode, 
        MinMargin2, 
        LiqMargin2, 
        Interest2,  
        lyraLiqPool.address, 
        liq_return.mul(2), //fake LIQ_RETURN used for ease of tests 
        LYRA
        );     

      let collateralValue = await vault.priceCollateralToUSD(lyraCode, colQuantity);
      liquidationLoanSize = collateralValue.div(numerator).mul(divider)
      
      await vault.connect(addr1).openLoan(lyraLPToken.address, colQuantity, liquidationLoanSize); //i.e. 10mill / 1.1 so liquidatable
      const openingVirtualPrice = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      const MinMargin3 = ethers.utils.parseEther("2.0");
      const LiqMargin3 = ethers.utils.parseEther("1.1");

      await collateralBook.TESTchangeCollateralType(
        lyraLPToken.address, 
        lyraCode, 
        MinMargin3, 
        LiqMargin3, 
        Interest2, 
        lyraLiqPool.address, 
        liq_return.mul(2), //fake LIQ_RETURN used for ease of tests
        LYRA
        ); 

      let loanReceived = await isoUSD.balanceOf(addr1.address); 
      await isoUSD.connect(addr1).transfer(addr2.address, loanReceived);  
      //openLoan didn't verify conditions remain after changing collateral properties so verifying here
      let debt = (await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)).mul(openingVirtualPrice).div(e18)
      //debt = Math.ceil(debt);
      //occasional rounding errors so we can't check exactly.
      expect(debt).to.be.closeTo(liquidationLoanSize, 2);
      expect(await vault.collateralPosted(lyraLPToken.address, addr1.address)).to.equal(colQuantity);
      
       
       
    });

    it("Should liquidate if entire loan is eligible to liquidate and emit Liquidation & BadDebtCleared events", async function () {
      liq_return = await vault.LIQUIDATION_RETURN();
      const helperAmount = ethers.utils.parseEther("1000");
      const helperLoan = helperAmount.div(2);

      await lyraLPToken.connect(addr1).transfer(addr2.address, helperAmount);
      await lyraLPToken.connect(addr2).approve(vault.address, helperAmount);

      const beforeLoanisoUSD = await isoUSD.balanceOf(addr2.address);
      await vault.connect(addr2).openLoan(lyraLPToken.address, helperAmount, helperLoan);
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      receivedLoan = helperLoan.mul(base.sub(loanOpenfee)).div(base);
      expect(beforeisoUSDBalance).to.equal(beforeLoanisoUSD.add(receivedLoan));

      const beforeColLiquidatorBalance = await lyraLPToken.balanceOf(addr2.address);

      //modify minimum collateral ratio to enable liquidation
      const MinMargin4 = ethers.utils.parseEther("8.0");
      const LiqMargin4 = ethers.utils.parseEther("7.0");
      const Interest4 = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
      await collateralBook.TESTchangeCollateralType(lyraLPToken.address, lyraCode, MinMargin4, LiqMargin4, Interest4, lyraLiqPool.address, liq_return, LYRA);      
      
      const totalCollateralinisoUSD = await vault.priceCollateralToUSD(lyraCode, colQuantity); //Math.round(ethPrice * colQuantity);
      const amountLiquidated = totalCollateralinisoUSD.mul(base.sub(liquidatorFeeBN)).div(base); 
      const virtualDebtBegin = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address);
      ethPriceBN =  await vault.priceCollateralToUSD(lyraCode, e18);
      await vault.viewLiquidatableAmount(colQuantity, ethPriceBN, loanSizeInisoUSD, LiqMargin4)
      //approve vault to take isoUSD from liquidator
      let balance = await isoUSD.connect(addr2).balanceOf(addr2.address)
      await isoUSD.connect(addr2).approve(vault.address, balance)
      
      const call = await vault.connect(addr2).callLiquidation(addr1.address, lyraLPToken.address);
      expect(call).to.emit(vault, 'Liquidation').withArgs(addr1.address, addr2.address, amountLiquidated-1, lyraCode, colQuantity);
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      //rounding errors?
      let error_factor = beforeisoUSDBalance.sub(amountLiquidated).div(10000) //0.01% deviation allowed
      expect(AfterisoUSDBalance).to.closeTo(beforeisoUSDBalance.sub(amountLiquidated), error_factor);
      
      const AfterColVaultBalance = await lyraLPToken.balanceOf(vault.address);
      //Should just be collateral from addr2's loan now
      expect(AfterColVaultBalance).to.equal(helperAmount); 

      const AfterColLiquidatorBalance = await lyraLPToken.balanceOf(addr2.address);
      expect(AfterColLiquidatorBalance).to.equal(beforeColLiquidatorBalance.add(colQuantity));
      
      const virtualPriceEnd = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      const realDebt = (await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)).mul(virtualPriceEnd).div(e18)
      const isoUSDreturning = totalCollateralinisoUSD.mul(liquidatorFeeBN).div(base); //adjustment for liquidation bonus of 5% 
      expect(realDebt).to.equal(0);
      
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      expect(principle).to.equal(0);

      expect(await vault.collateralPosted(lyraLPToken.address, addr1.address)).to.equal(0);
      
      const badDebtQuantity = (virtualDebtBegin.mul(virtualPriceEnd).div(base)).sub(amountLiquidated);
      expect(call).to.emit(vault, 'BadDebtCleared').withArgs(addr1.address, addr2.address, badDebtQuantity+1, lyraCode);
      
    });

    
    it("Should partially liquidate loan if possible and emit Liquidation event", async function () {
      //need to open loan for addr2 here
      const reduceAmount = ethers.utils.parseEther("304");
      await lyraLPToken.connect(addr1).transfer(addr2.address, reduceAmount.mul(2));
      await lyraLPToken.connect(addr2).approve(vault.address, reduceAmount.mul(2))
      await vault.connect(addr2).openLoan(lyraLPToken.address, reduceAmount.mul(2), reduceAmount);
      const totalAddr2isoUSD = await isoUSD.balanceOf(addr2.address);
      await isoUSD.connect(addr2).transfer(addr1.address, totalAddr2isoUSD);
      

      const MinMargin5 = ethers.utils.parseEther("1.001");
      const LiqMargin5 = ethers.utils.parseEther("1.0");
      const Interest5 = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
      await collateralBook.TESTchangeCollateralType(lyraLPToken.address, lyraCode, MinMargin5, LiqMargin5, Interest5, lyraLiqPool.address, liq_return.mul(2), LYRA); //fake LIQ_RETURN used for ease of tests

      let loanRepayment = liquidationLoanSize.div(5)
      await isoUSD.connect(addr1).approve(vault.address, loanRepayment)
      await vault.connect(addr1).closeLoan(lyraLPToken.address, 0, loanRepayment);
      const totalAddr1isoUSD = await isoUSD.balanceOf(addr1.address);
      await isoUSD.connect(addr1).transfer(addr2.address, totalAddr1isoUSD);

      const beforeisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      const beforeColBalanceVault = await lyraLPToken.balanceOf(vault.address);
      const principleBefore = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      const beforeColBalance = await lyraLPToken.balanceOf(addr2.address);
     

      ethPriceBN = await vault.priceCollateralToUSD(lyraCode, e18);
      const MinMargin6 = ethers.utils.parseEther("2.0");
      const LiqMargin6 = ethers.utils.parseEther("1.5");
      await collateralBook.TESTchangeCollateralType(lyraLPToken.address, lyraCode, MinMargin6, LiqMargin6, Interest5, lyraLiqPool.address, liq_return.mul(2), LYRA); //fake LIQ_RETURN used for ease of tests
      const virtualDebtBegin = await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address);
      let balance = await isoUSD.connect(addr2).balanceOf(addr2.address)
      
      //approve vault to take isoUSD from liquidator
      await isoUSD.connect(addr2).approve(vault.address, balance)
      const tx = await vault.connect(addr2).callLiquidation(addr1.address, lyraLPToken.address)
      
      const virtualPriceEnd = await collateralBook.viewVirtualPriceforAsset(lyraLPToken.address);
      const realLoanOwed = virtualDebtBegin.mul(virtualPriceEnd).div(e18);
      const liquidateCollateral = await vault.viewLiquidatableAmount(colQuantity, ethPriceBN, realLoanOwed, LiqMargin6)
      const liquidatorPayback = (await vault.priceCollateralToUSD(lyraCode, liquidateCollateral)).mul(base.sub(liquidatorFeeBN)).div(base); 
      
      expect (tx).to.emit(vault, 'Liquidation').withArgs(addr1.address, addr2.address, liquidatorPayback, lyraCode, liquidateCollateral);  
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      let error_factor = beforeisoUSDBalance.sub(liquidatorPayback).div(10000) //0.01% deviation allowed
      expect(AfterisoUSDBalance).to.closeTo(beforeisoUSDBalance.sub(liquidatorPayback), error_factor);
      
      const AfterColBalanceVault = await lyraLPToken.balanceOf(vault.address);
      expect(AfterColBalanceVault).to.equal(beforeColBalanceVault.sub(liquidateCollateral));
      
      const AfterColBalance = await lyraLPToken.balanceOf(addr2.address);
      expect(AfterColBalance).to.equal(beforeColBalance.add(liquidateCollateral));
      //rounding leaves 1 debt, not important as we work in 18dp
      
      const principle = await vault.isoUSDLoaned(lyraLPToken.address, addr1.address)
      let error = principleBefore.mul(10).div(e18) // less than 0.00000000000001% error
      expect(principle).to.be.closeTo(principleBefore.sub(liquidatorPayback),error); //rounding error again

      const realDebt = (await vault.isoUSDLoanAndInterest(lyraLPToken.address, addr1.address)).mul(virtualPriceEnd).div(e18);
      const expectedVirtualDebt = virtualDebtBegin.sub(liquidatorPayback.mul(base).div(virtualPriceEnd));
      let error_margin = expectedVirtualDebt.mul(virtualPriceEnd).div(e18).div(10000) //0.01% error margin
      expect(realDebt).to.be.closeTo(expectedVirtualDebt.mul(virtualPriceEnd).div(e18), error_margin); //varies occasionally due to JS rounding
      expect(await vault.collateralPosted(lyraLPToken.address, addr1.address)).to.equal(colQuantity.sub(liquidateCollateral));
      
    });

    //slow
    it("Should liquidate for a Lyra collateral with triggered Circuit Breaker only once its time has expired", async function () {
      this.timeout(350000);
      const helperAmount = ethers.utils.parseEther("1000");
      const helperLoan = helperAmount.div(2);
      await lyraLPToken.connect(addr1).transfer(addr2.address, helperAmount);
      await lyraLPToken.connect(addr2).approve(vault.address, helperAmount);

      await vault.connect(addr2).openLoan(lyraLPToken.address, helperAmount, helperLoan);
      
      let MinMargin = ethers.utils.parseEther("1.001"); 
      let LiqMargin = ethers.utils.parseEther("1.0");
      let Interest = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
      await collateralBook.TESTchangeCollateralType(lyraLPToken.address, lyraCode, MinMargin, LiqMargin, Interest, lyraLiqPool.address, liq_return.mul(2), LYRA);   //fake LIQ_RETURN used for ease of tests   

      const collateralUsed = ethers.utils.parseEther("120");
      const loanTaken = ethers.utils.parseEther("100");
      tx = await lyraLPToken.connect(addr1).approve(vault.address, collateralUsed);
      const block = await ethers.provider.getBlock(tx.blockNumber);
      const currentTime = block.timestamp;
      await vault.connect(addr1).openLoan(lyraLPToken.address, collateralUsed, loanTaken);


      const beforeColBalance = await lyraLPToken.balanceOf(vault.address);
      
      const beforeColLiquidatorBalance = await lyraLPToken.balanceOf(addr2.address);
      //modify collateral ratios to enable liquidation
      MinMargin = ethers.utils.parseEther("8.0"); 
      LiqMargin = ethers.utils.parseEther("7.0");
      tx = await collateralBook.TESTchangeCollateralType(lyraLPToken.address, lyraCode, MinMargin, LiqMargin, Interest, lyraLiqPool.address, liq_return.mul(2), LYRA);   //fake LIQ_RETURN used for ease of tests   
      
      //grab a timestamp from a nearby transaction
      const beginBlock = await ethers.provider.getBlock(tx.blockNumber);
      const startTime = beginBlock.timestamp;
      //trigger Lyra CB here by overwriting CBTimestamp in slot 33 of LiquidityPool storage
      const timestamp = ethers.utils.hexZeroPad(ethers.utils.hexlify(startTime + 100), 32)
      await network.provider.send("hardhat_setStorageAt", [
        "0x5Db73886c4730dBF3C562ebf8044E19E8C93843e",
        "0x21",
        timestamp, //10 seconds into the future, we don't want other pricefeeds to go stale
      ]);
      await expect(vault.connect(addr2).callLiquidation(addr1.address, lyraLPToken.address)).to.revertedWith("Lyra Circuit Breakers active, can't trade");

      const circuitBreakerTime = await lyraLiqPool.CBTimestamp()
      
      helpers.timeSkip(circuitBreakerTime - currentTime);

      //approve vault to take isoUSD from liquidator
      let balance = await isoUSD.connect(addr2).balanceOf(addr2.address)
      await isoUSD.connect(addr2).approve(vault.address, balance)

      await vault.connect(addr2).callLiquidation(addr1.address, lyraLPToken.address);
      
      
    });
    
    it("Should revert if liquidator lacks isoUSD to repay debt", async function () {
      liq_return = await vault.LIQUIDATION_RETURN();
      const startisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      await isoUSD.connect(addr2).transfer(addr1.address, startisoUSDBalance);
      const beforeisoUSDBalance = await isoUSD.balanceOf(addr2.address);
      expect(beforeisoUSDBalance).to.equal(0);
      const beforeColBalance = await lyraLPToken.balanceOf(vault.address);
      expect(beforeColBalance).to.equal(colQuantity);

      //modify minimum collateral ratio to enable liquidation
      const MinMargin4 = ethers.utils.parseEther("8.0");
      const LiqMargin4 = ethers.utils.parseEther("6.0");
      const Interest4 = ethers.utils.parseEther("1.19710969"); //1.001^180 i.e. 3 mins continiously compounding per second
      await collateralBook.TESTchangeCollateralType(lyraLPToken.address, lyraCode, MinMargin4, LiqMargin4, Interest4, lyraLiqPool.address, liq_return, LYRA); 
      
      //approve vault to take isoUSD from liquidator
      await isoUSD.connect(addr2).approve(vault.address, startisoUSDBalance)
      
      await expect(vault.connect(addr2).callLiquidation(addr1.address, lyraLPToken.address)).to.be.revertedWith('ERC20: transfer amount exceeds balance');
    });
       

    it("Should fail if system is paused", async function () {
      await vault.pause();
      await expect(
        vault.connect(addr2).callLiquidation(addr1.address, lyraLPToken.address)
      ).to.be.revertedWith("Pausable: paused");
    });

    it("Should fail to liquidate if the collateral token is unsupported", async function () {
      await expect(
        vault.connect(addr2).callLiquidation(addr1.address, FakeAddr)
      ).to.be.revertedWith("Unsupported collateral!");
    });

    it("Should fail to liquidate if the collateral is paused in CollateralBook", async function () {
      await collateralBook.pauseCollateralType(lyraLPToken.address, lyraCode);
      await expect(
        vault.connect(addr2).callLiquidation(addr1.address, lyraLPToken.address)
      ).to.be.revertedWith("Unsupported collateral!");
    });


    it("Should fail to liquidate if the collateral token is not set", async function () {
      await expect(
        vault.connect(addr2).callLiquidation(addr1.address, ZERO_ADDRESS)
      ).to.be.revertedWith("Unsupported collateral!");

    });

    it("Should fail to liquidate if the debtor address is not set", async function () {
      await expect(
        vault.connect(addr2).callLiquidation(ZERO_ADDRESS, lyraLPToken.address)
      ).to.be.revertedWith("Zero address used");

    });

    it("Should fail to liquidate if flagged loan isn't at liquidatable margin level", async function () {
      const loanAmount = ethers.utils.parseEther("100");
      const collateralAmount = ethers.utils.parseEther("200");
      //add a price check here that the collateral is valued greater than required amount for fuzzing?
      await lyraLPToken.connect(addr1).transfer(addr2.address, collateralAmount);
      await lyraLPToken.connect(addr2).approve(vault.address, collateralAmount);
      await vault.connect(addr2).openLoan(lyraLPToken.address, collateralAmount, loanAmount);
      await expect(
        vault.connect(addr1).callLiquidation(addr2.address, lyraLPToken.address)
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
    const TIME_DELAY = 3*24*60*60 //3 day second timelock 

    it("Should not allow anyone to call it", async function () {
      await expect( vault.connect(addr2).setTreasury()).to.be.revertedWith("Caller is not an admin"); 
    });
    it("Should revert if no treasury change is pending", async function () {
      await expect( vault.connect(owner).setTreasury()).to.be.reverted; 
    });
    it("Should succeed if change is pending and only when timelock has passed", async function () {
      old_treasury = await vault.treasury()
      new_treasury = addr2.address
      await vault.connect(owner).proposeTreasury(new_treasury)
      //check set call reverts when timelock has not passed
      await expect( vault.connect(owner).setTreasury()).to.be.reverted; 
      //skip time past timelock deadline
      helpers.timeSkip(TIME_DELAY);
      await expect( vault.connect(owner).setTreasury()).to.emit(vault, 'ChangeTreasury').withArgs(old_treasury, new_treasury)
    });       
  
    
  });

  describe("proposeTreasury", function () {
    const TIME_DELAY = 3*24*60*60 //3 day second timelock
    
    it("Should not allow anyone to call it", async function () {
      const new_treasury = addr2.address
      await expect( vault.connect(addr2).proposeTreasury(new_treasury)).to.be.revertedWith("Caller is not an admin"); 
    });
    it("Should revert if zero address is propose as treasury", async function () {
      await expect( vault.connect(owner).proposeTreasury(ZERO_ADDRESS)).to.be.reverted; 
    });
    it("Should succeed if given valid conditions", async function () {
      old_treasury = await vault.treasury()
      const new_treasury = addr2.address
      const tx = await vault.connect(owner).proposeTreasury(new_treasury)
      const block = await ethers.provider.getBlock(tx.blockNumber);
      
      expect(await vault.pendingTreasury()).to.equal(new_treasury)
      expect(await vault.updateTreasuryTimestamp()).to.equal(block.timestamp+TIME_DELAY)

    });       
  
    
  });


  describe("Role based access control", function () {
    const TIME_DELAY = 3*24*60*60+1 //3 day second timelock +1s
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
