// We import Chai to use its asserting functions here.
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { helpers } = require("../testHelpers.js")

const BLOCK_HEIGHT = 13908578;//5th Jan 2022

const base = ethers.BigNumber.from('1000000000000000000'); // 1eth



async function impersonateForToken(provider, receiver, ERC20, donerAddress, amount) {
  //let treasurysUSD = "0x99f4176ee457afedffcb1839c7ab7a030a5e4a92"; //Synthetix treasury, has ETH and sUSD
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

describe("Unit tests: Vault_Velo contract", function () {
  

  let Token;
  let hardhatToken;
  let owner; //0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266
  let alice; //0x70997970c51812dc3a010c7d01b50e0d17dc79c8
  let bob; //0x3c44cdddb6a900fa2b585dd299e03d12fa4293bc
  let addrs;
  let signer;
  const ZERO_ADDRESS = ethers.constants.AddressZero;
  let loanOpenfee = ethers.utils.parseEther('0.01'); //1%
  let liquidatorFee = ethers.utils.parseEther('0.05'); //5%
  const addingCollateral = true; //bool used to indicate if we're adding collateral on an openLoan call.
  const maxNoOfCollaterals = 8; //max number of NFTs deposited as collateral for one loan
  
  const testCode = ethers.utils.formatBytes32String("test");
  const sUSDCode = ethers.utils.formatBytes32String("sUSD");
  const NFTCode = ethers.utils.formatBytes32String("sAMM-USDC-sUSD");
  const MINTER = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));

  const e18 = ethers.utils.parseEther('1');
  const zero = ethers.utils.parseEther('0');
  const TENTH_OF_CENT =  ethers.utils.parseEther('0.001') //$0.001 used as max leftover loan that is ignored as being dust
  
  const provider = ethers.provider;

  function timeSkipRequired(totalInterest){
    //helper function to automatically determine the amount of time skips needed to achieve the required interest owed
    let decimalThreeMinInterest = threeMinInterest /100000000;
    let powerNeeded = (Math.log(totalInterest) / Math.log(decimalThreeMinInterest));
    let timeSkipinSecs = powerNeeded*180;
    return timeSkipinSecs;
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

  const VELO = 2;
  let snapshotId;
  const threeMinInterest = 100000180 //119710969;
  // set up test base frame in before block
  before(async function () {
        // Get the ContractFactory and Signers here 
        const provider = ethers.provider;
        [owner, alice, bob, ...addrs] = await ethers.getSigners()

        //console.log("PROVIDER ", provider); 
        
        //fetch relevant contracts
        DepositReceipt = await ethers.getContractFactory("TESTDepositReceipt")
        Router = await ethers.getContractFactory("TESTRouter")
        vaultContract = await ethers.getContractFactory("Vault_Velo")
        isoUSDcontract = await ethers.getContractFactory("isoUSDToken");
        
        collateralContract = await ethers.getContractFactory("TESTCollateralBook");
        PriceOracle = await ethers.getContractFactory("TESTAggregatorV3")

        //set up deposit receipt and it's prerequiste router & price oracle
        router = await Router.deploy()
        priceOracle = await PriceOracle.deploy()

        depositReceipt = await DepositReceipt.deploy(
            "Deposit_Receipt",
            "DR",
            router.address,
            alice.address,
            bob.address,
            true,
            priceOracle.address
            )
        //mint depositReceipt Tokens to test with    
        const amount= ethers.utils.parseEther('1000')
        await depositReceipt.connect(alice).UNSAFEMint(amount)

        //deploy token and treasury
        isoUSD = await isoUSDcontract.deploy();
   
        treasury = addrs[1]

        //deploy vault and collateralBook
        collateralBook = await collateralContract.deploy(); 
        vault = await vaultContract.deploy(isoUSD.address, treasury.address, collateralBook.address);
        // link collateralBook to vault
        await collateralBook.addVaultAddress(vault.address, VELO);
        
        
        await isoUSD.proposeAddRole(vault.address, MINTER);
        helpers.timeSkip(3*24*60*60+1) //3 days 1s required delay
        await isoUSD.addRole(vault.address, MINTER);
        const NFTMinMargin = ethers.utils.parseEther("2.0");
        const NFTLiqMargin = ethers.utils.parseEther("1.1");
        const NFTInterest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
        
        await collateralBook.addCollateralType(depositReceipt.address, NFTCode, NFTMinMargin, NFTLiqMargin, NFTInterest, VELO, ZERO_ADDRESS);
        

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
    it("Should deploy the constructor args to the right addresses", async function (){
      expect( await vault.isoUSD()).to.equal(isoUSD.address);
      expect( await vault.treasury()).to.equal(treasury.address);
      expect( await vault.collateralBook()).to.equal(collateralBook.address);
    });
  });
  

  
   
  describe("OpenLoans", function () {
    it("Should mint user isoUSD if given valid conditions at time zero and emit OpenLoan event", async function () {
      const NFTId = 1;

      const beforeAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const loanTaken = collateralUsed.div(2)
      const beforeOwner = await depositReceipt.ownerOf(NFTId)
      expect(beforeOwner).to.equal(alice.address)
      //approve transfer of depositReceipt NFT and call openLoan
      await depositReceipt.connect(alice).approve(vault.address, NFTId)
      await expect(vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken, NFTCode,collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
      const afterOwner = await depositReceipt.ownerOf(NFTId)
      expect(afterOwner).to.equal(vault.address)

      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(loanTaken)

      const loanAndInterest = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      //at time zero this should match principle
      expect(loanAndInterest).to.equal(loanTaken)
      
    });

    it("Should function after pausing and unpausing system", async function () {
      const NFTId = 1;
      const beforeAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const loanTaken = collateralUsed.div(3)

      const beforeOwner = await depositReceipt.ownerOf(NFTId)
      expect(beforeOwner).to.equal(alice.address)

      await vault.pause();
      await vault.unpause();

      await depositReceipt.connect(alice).approve(vault.address, NFTId)
      await expect(vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken, NFTCode,collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(alice.address);
      //rounding error here so allow error of 1
      expect(AfterAddr1Balance).to.be.closeTo(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)), 1)
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
      const afterOwner = await depositReceipt.ownerOf(NFTId)
      expect(afterOwner).to.equal(vault.address)
      
    });


    it("Should function after pausing and unpausing collateral in CollateralBook", async function () {
      const NFTId = 1;

      const beforeAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const loanTaken = collateralUsed.div(4)

      const beforeOwner = await depositReceipt.ownerOf(NFTId)
      expect(beforeOwner).to.equal(alice.address)

      //pause collateral
      expect(await collateralBook.collateralPaused(depositReceipt.address)).to.equal(false);
      await collateralBook.pauseCollateralType(depositReceipt.address, NFTCode);
      //check collateral is paused
      expect(await collateralBook.collateralPaused(depositReceipt.address)).to.equal(true);
      //unpause collateral
      await collateralBook.unpauseCollateralType(depositReceipt.address, NFTCode);
      expect(await collateralBook.collateralPaused(depositReceipt.address)).to.equal(false);

      //approve transfer of depositReceipt NFT and call openLoan
      await depositReceipt.connect(alice).approve(vault.address, NFTId)
      await expect(vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken, NFTCode,collateralUsed );
      
      const AfterAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
      const afterOwner = await depositReceipt.ownerOf(NFTId)
      expect(afterOwner).to.equal(vault.address)
      
    });

    it("Should be possible to increase existing loan and emit OpenOrIncreaseLoan event", async function () {
      const NFTId = 1;
      const NO_NFT = 0;
      const data = await priceOracle.latestRoundData();
      const block = await ethers.provider.getBlock(data.blockNumber);

      const beforeAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const loanTaken = collateralUsed.div(4)
      const loanTaken2 = collateralUsed.div(5)

      const beforeOwner = await depositReceipt.ownerOf(NFTId)
      expect(beforeOwner).to.equal(alice.address)

      await depositReceipt.connect(alice).approve(vault.address, NFTId)
      await expect(vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, true)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken, NFTCode,collateralUsed );
      
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(loanTaken)

      let middleAddr1Balance = await isoUSD.balanceOf(alice.address);
      //allow an error of 1 for rounding mistakes
      expect(middleAddr1Balance).to.be.closeTo(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)), 1)
      
      const middleTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(middleTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));

      const middleOwner = await depositReceipt.ownerOf(NFTId)
      expect(middleOwner).to.equal(vault.address)

      //increase existing loan without adding any collateral.
      await expect(vault.connect(alice).openLoan(depositReceipt.address, NO_NFT, loanTaken2, false)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken2, NFTCode, 0 );
      
      //repeat state checks
      const AfterAddr1Balance = await isoUSD.balanceOf(alice.address);
      //allow an error of 1 for rounding mistakes
      expect(AfterAddr1Balance).to.be.closeTo(beforeAddr1Balance.add(((loanTaken.add(loanTaken2)).mul(base.sub(loanOpenfee))).div(base)), 1)
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.add(loanTaken2).mul(loanOpenfee).div(base));

      const afterOwner = await depositReceipt.ownerOf(NFTId)
      expect(afterOwner).to.equal(vault.address)

      const principleAfter = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principleAfter).to.equal(principle.add(loanTaken2))

    });
  
    it("Should openLoan and record debt corrected after time elasped in system", async function () {
      const NFTId = 1;
      const beforeAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const loanTaken = collateralUsed.div(2)

      const beforeOwner = await depositReceipt.ownerOf(NFTId)
      expect(beforeOwner).to.equal(alice.address)

      await depositReceipt.connect(alice).approve(vault.address, NFTId)

      const timestep = 1000;
      helpers.timeSkip(timestep);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      expect(virtualPrice).to.equal(base);

      await expect(vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken, NFTCode,collateralUsed );
    
      const AfterAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((loanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(loanTaken.mul(loanOpenfee).div(base));
      
      const afterOwner = await depositReceipt.ownerOf(NFTId)
      expect(afterOwner).to.equal(vault.address)
      //check debt after timestep was recorded correctly.
      const virtualDebtBalance = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPriceUpdate = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address); 
      const debt = loanTaken.mul(base).div(virtualPriceUpdate);
      expect(virtualDebtBalance).to.equal(debt);

      //principle should be recorded as loan, unaffected by time changing
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(loanTaken)
      
    });

    it("Should allow adding multiple NFTs to the same loan but revert when limit is reached", async function (){
      const amount2 = ethers.utils.parseEther('4');
      const NFTId = 1;
      const NFTId2 = 2;
      depositReceipt.connect(alice).UNSAFEMint(amount2)
      
      const beforeAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(beforeAddr1Balance).to.equal(0);

      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(beforeTreasuryBalance).to.equal(0);

      //determine loan amounts based on value of collateral NFTs used
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const pooledTokens2 = await depositReceipt.pooledTokens(NFTId2)
      const collateralUsed2 = await depositReceipt.priceLiquidity(pooledTokens2)
      const loanTaken = collateralUsed.div(2)
      const loanTaken2 = collateralUsed2.div(4)

      const beforeOwner_NFT1 = await depositReceipt.ownerOf(NFTId)
      expect(beforeOwner_NFT1).to.equal(alice.address)

      const beforeOwner_NFT2 = await depositReceipt.ownerOf(NFTId2)
      expect(beforeOwner_NFT2).to.equal(alice.address)
      //approve NFTs for transfer and call first openLoan
      await depositReceipt.connect(alice).approve(vault.address, NFTId);
      await depositReceipt.connect(alice).approve(vault.address, NFTId2);
      await expect(vault.connect(alice).openLoan(depositReceipt.address,NFTId, loanTaken, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken, NFTCode,collateralUsed );
      
      //check intermediate principle is correct
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(loanTaken)
      
      //call second openLoan
      await expect(vault.connect(alice).openLoan(depositReceipt.address,NFTId2, loanTaken2, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken2, NFTCode,collateralUsed2 );
      
      const principleAfter = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principleAfter).to.equal(loanTaken.add(loanTaken2))
      //if no time has passed the interest = 0
      const totalLoanAfter = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      expect(totalLoanAfter).to.equal(loanTaken.add(loanTaken2))

      const AfterAddr1Balance = await isoUSD.balanceOf(alice.address);
      const totalLoanTaken = loanTaken.add(loanTaken2)
      expect(AfterAddr1Balance).to.equal(beforeAddr1Balance.add((totalLoanTaken.mul(base.sub(loanOpenfee))).div(base)))
      
      const AfterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(AfterTreasuryBalance).to.equal(totalLoanTaken.mul(loanOpenfee).div(base));

      const afterOwner_NFT1 = await depositReceipt.ownerOf(NFTId)
      expect(afterOwner_NFT1).to.equal(vault.address)

      const afterOwner_NFT2 = await depositReceipt.ownerOf(NFTId2)
      expect(afterOwner_NFT2).to.equal(vault.address)

      let loanIds = []
      for(let i =0; i < maxNoOfCollaterals; i++ ){
        loanIds.push((await vault.getLoanNFTids(alice.address, depositReceipt.address, i)).toNumber());
      }
      expect(loanIds.indexOf(NFTId)).to.equal(0);
      expect(loanIds.indexOf(NFTId2)).to.equal(1);

     
    })

    it("Should revert if all collateral slots are full", async function () {
      let newNFTIds = []
      const amount = ethers.utils.parseEther('4');
      for( let i = 0; i < maxNoOfCollaterals; i++){
        await depositReceipt.connect(alice).UNSAFEMint(amount)
        newNFTIds.push(1+i)
        await depositReceipt.connect(alice).approve(vault.address, 1+i)
        await vault.connect(alice).openLoan(depositReceipt.address, 1+i, 1, true)
      
      }
      //load in stored NFTIds for this loan
      let loanIds = []
      for(let i =0; i < maxNoOfCollaterals; i++ ){
        loanIds.push((await vault.getLoanNFTids(alice.address, depositReceipt.address, i)).toNumber());
      }
      //verify they match the NFTs deposited.
      for (let i = 0; i < maxNoOfCollaterals -1 ; i++){
        await expect(loanIds.indexOf(newNFTIds[i])).to.equal(i);

      }
      
      //try to add more collateral NFTs than allowed.
      await depositReceipt.connect(alice).UNSAFEMint(amount)
      rejectedNFTId = 1 + maxNoOfCollaterals
      await depositReceipt.connect(alice).approve(vault.address, rejectedNFTId)
      await expect(vault.connect(alice).openLoan(depositReceipt.address, rejectedNFTId, 1, true)).to.be.revertedWith("All NFT slots for loan used");
      
      
    });

    it("Should not add new collateral NFT details if addingCollateral is false", async function () {
      const NFTId = 1;
      let loanTaken = 1
      //approve transfer of depositReceipt NFT and call openLoan
      await depositReceipt.connect(alice).approve(vault.address, NFTId)
      await vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)


      let notAddingCollateral = false
      let newNFTId = 2
      vault.connect(alice).openLoan(depositReceipt.address, newNFTId, loanTaken, notAddingCollateral)

      expect( await vault.getLoanNFTids(alice.address, depositReceipt.address, 0)).to.equal(1)

      for(let i =1; i < maxNoOfCollaterals; i++ ){
        expect( await vault.getLoanNFTids(alice.address, depositReceipt.address, i)).to.equal(0)
      }
      
      
    });



    it("Should only not update virtualPrice if called multiple times within 3 minutes", async function () {
      const loanTaken = 500000 
      const NFTId = 1;  
      await depositReceipt.connect(alice).approve(vault.address, NFTId);

      let tx = await vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, true)
      let virtualPrice_1 = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      useless_NFT_id = 99
      let tx_2 = await vault.connect(alice).openLoan(depositReceipt.address, useless_NFT_id, loanTaken, false)
      let virtualPrice_2 = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);

      //check timestamps are within 3 minutes of each other
      const block_1 = await ethers.provider.getBlock(tx.blockNumber);
      const block_2 = await ethers.provider.getBlock(tx_2.blockNumber);
      const THREE_MINS = 3 *60
      expect(block_1.timestamp).to.be.closeTo(block_2.timestamp, THREE_MINS)

      //if we are within 3 minutes both virtual prices should be the same
      expect(virtualPrice_1).to.equal(virtualPrice_2)
    });

    it("Should only not update another collateral's virtualPrice if called", async function () {
      //second collateral to use
      depositReceipt2 = await DepositReceipt.deploy(
        "Deposit_Receipt_Two",
        "DR2",
        router.address,
        alice.address,
        bob.address,
        true,
        priceOracle.address
        )
      //mint depositReceipt Tokens to test with    
      const amount= ethers.utils.parseEther('1000')
      await depositReceipt2.connect(alice).UNSAFEMint(amount)
      
      let NFTCode_2 = ethers.utils.formatBytes32String("vAMM-USDC-OP");
      const NFTMinMargin = ethers.utils.parseEther("2.0");
      const NFTLiqMargin = ethers.utils.parseEther("1.1");
      const NFTInterest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      await collateralBook.addCollateralType(depositReceipt2.address, NFTCode_2, NFTMinMargin, NFTLiqMargin, NFTInterest, VELO, ZERO_ADDRESS);

      const loanTaken = 500000 
      const NFTId = 1;  
      await depositReceipt2.connect(alice).approve(vault.address, NFTId);

      let virtualPrice_other_asset = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);

      await vault.connect(alice).openLoan(depositReceipt2.address, NFTId, loanTaken, true)
      
      let virtualPrice_other_asset_after = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      
      //if we are within 3 minutes both virtual prices should be the same
      expect(virtualPrice_other_asset).to.equal(virtualPrice_other_asset_after)
    });

    it("Should fail if addingCollateral is false and opening new loan", async function () {
      const loanTaken = 500000 
      const NFTId = 1;  
      await depositReceipt.connect(alice).approve(vault.address, NFTId);
      await expect(
        vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, false)
      ).to.be.revertedWith("Minimum margin not met!");

    });
    
    it("Should fail if daily max Loan amount exceeded", async function () {
      const loanTaken = 500000 
      const NFTId = 1;  
      await vault.connect(owner).setDailyMax(1000);
      await depositReceipt.connect(alice).approve(vault.address, NFTId);
      await expect(
        vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)
      ).to.be.revertedWith("Try again tomorrow loan opening limit hit");

    });
    
    it("Should fail if using unsupported collateral token", async function () {
      await expect(
        vault.connect(bob).openLoan(owner.address, 1000000, 500000, addingCollateral)
      ).to.be.revertedWith("Unsupported collateral!");

    });
    

    it("Should fail if vault paused", async function () {
      const loanTaken = 500000 
      const NFTId = 1;  
      await vault.pause();
      await depositReceipt.connect(alice).approve(vault.address, NFTId);
      await expect(
        vault.connect(alice).openLoan(depositReceipt.address,NFTId, loanTaken, addingCollateral)
      ).to.be.revertedWith("Pausable: paused");


    });

    it("Should fail if collateral is paused in CollateralBook", async function () {
      const loanTaken = 500000 
      const NFTId = 1;  
      await depositReceipt.connect(alice).approve(vault.address, NFTId);
      await collateralBook.pauseCollateralType(depositReceipt.address, NFTCode);
      await expect(
        vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)
      ).to.be.revertedWith("Unsupported collateral!");
    });
    

    it("Should fail if sender doesn’t own the specified NFT", async function () {
      const loanTaken = 500000 
      const NFTId = 1;  
      await expect(
        vault.connect(bob).openLoan(depositReceipt.address,NFTId, loanTaken, addingCollateral)
      ).to.be.revertedWith("Only NFT owner can openLoan");

    });
  
    it("Should fail if sender requests too much isoUSD", async function () {
      const NFTId = 1;
      const pooledTokens = await depositReceipt.connect(alice).pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.connect(alice).priceLiquidity(pooledTokens)
      const loanTaken = collateralUsed
      
      await depositReceipt.connect(alice).approve(vault.address, NFTId);
      await expect(
        vault.connect(alice).openLoan(depositReceipt.address,NFTId, loanTaken, addingCollateral)
      ).to.be.revertedWith("Minimum margin not met!");

    });


    it("Should fail if sender tries to use 0th index NFT", async function () {
      const loanTaken = 500000 
      const NFTId = 0;  
      //as no 0th NFT exists there can be no approve here
      await expect(
        vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)
      ).to.be.revertedWith("No zero index NFTs allowed");

    });
    
    
  });

  describe("increaseCollateralAmount", function () {
    const NFTId = 1;
    const NFTId2 = 2;
    const bobNFT = 3;
    const amount2 = ethers.utils.parseEther('4');
    
    

    beforeEach(async function () {
      
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const loanTaken = collateralUsed.div(2)
      await depositReceipt.connect(alice).approve(vault.address, NFTId)
      await expect(vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken, NFTCode,collateralUsed );  

      //mint a 2nd and 3rd NFTs for testing the function
      await depositReceipt.connect(alice).UNSAFEMint(amount2)
      await depositReceipt.connect(bob).UNSAFEMint(amount2)
      
    });

    it("Should increase user loan collateral on existing loan and emit IncreaseCollateral event", async function () {
      const beforeAddr1Balance = await isoUSD.balanceOf(alice.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);

      const beforeOwner_NFT1 = await depositReceipt.ownerOf(NFTId)
      expect(beforeOwner_NFT1).to.equal(vault.address)

      const beforeOwner_NFT2 = await depositReceipt.ownerOf(NFTId2)
      expect(beforeOwner_NFT2).to.equal(alice.address)

      const pooledTokens = await depositReceipt.pooledTokens(NFTId2)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)

      const principleBefore = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      const loanBefore = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      
      await depositReceipt.connect(alice).approve(vault.address, NFTId2)
      await expect(vault.connect(alice).increaseCollateralAmount(depositReceipt.address, NFTId2)).to.emit(vault, 'IncreaseCollateralNFT').withArgs(alice.address, NFTCode, collateralUsed );
      
      //principle should be unchanged
      const principleAfter = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principleAfter).to.equal(principleBefore)

      //total loan (principle + interest) should be unchanged too
      const loanAfter = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      expect(loanAfter).to.equal(loanBefore)

      const afterAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(afterAddr1Balance).to.equal(beforeAddr1Balance);

      const afterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(afterTreasuryBalance).to.equal(beforeTreasuryBalance);
      
      const afterOwner_NFT1 = await depositReceipt.ownerOf(NFTId)
      expect(afterOwner_NFT1).to.equal(vault.address)

      const afterOwner_NFT2 = await depositReceipt.ownerOf(NFTId2)
      expect(afterOwner_NFT2).to.equal(vault.address)
      
    });

    it("Should function after pausing and unpausing system", async function () {
      const beforeAddr1Balance = await isoUSD.balanceOf(alice.address);
      const beforeTreasuryBalance = await isoUSD.balanceOf(treasury.address);

      const beforeOwner_NFT1 = await depositReceipt.ownerOf(NFTId)
      expect(beforeOwner_NFT1).to.equal(vault.address)
      const beforeOwner_NFT2 = await depositReceipt.ownerOf(NFTId2)
      expect(beforeOwner_NFT2).to.equal(alice.address)
      const pooledTokens = await depositReceipt.pooledTokens(NFTId2)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      
      await depositReceipt.connect(alice).approve(vault.address, NFTId2)
      await vault.pause();
      await vault.unpause();
      await expect(vault.connect(alice).increaseCollateralAmount(depositReceipt.address, NFTId2)).to.emit(vault, 'IncreaseCollateralNFT').withArgs(alice.address, NFTCode, collateralUsed );
      const afterAddr1Balance = await isoUSD.balanceOf(alice.address);
      expect(afterAddr1Balance).to.equal(beforeAddr1Balance);
      const afterTreasuryBalance = await isoUSD.balanceOf(treasury.address);
      expect(afterTreasuryBalance).to.equal(beforeTreasuryBalance);
      
      const afterOwner_NFT1 = await depositReceipt.ownerOf(NFTId)
      expect(afterOwner_NFT1).to.equal(vault.address)
      const afterOwner_NFT2 = await depositReceipt.ownerOf(NFTId2)
      expect(afterOwner_NFT2).to.equal(vault.address)
      
    });
    
    
    
    it("Should fail if using unsupported collateral token", async function () {
      await depositReceipt.connect(alice).approve(vault.address, NFTId2)
      await expect(vault.connect(alice).increaseCollateralAmount(bob.address, NFTId2)).to.be.revertedWith("Unsupported collateral!");
      
    });

    it("Should fail if vault paused", async function () {
      await vault.pause();
      await depositReceipt.connect(alice).approve(vault.address, NFTId2)
      await expect(vault.connect(alice).increaseCollateralAmount(depositReceipt.address, NFTId2)).to.be.revertedWith("Pausable: paused");
      
      
    });

    it("Should fail if all collateral slots are full", async function () {
      let newNFTIds = []
      for( let i = 1; i < maxNoOfCollaterals; i++){
        await depositReceipt.connect(alice).UNSAFEMint(amount2)
        newNFTIds.push(3+i)
        await depositReceipt.connect(alice).approve(vault.address, 3+i)
        await vault.connect(alice).increaseCollateralAmount(depositReceipt.address, 3+i)
      
      }
      //load in stored NFTIds for this loan
      let loanIds = []
      for(let i =0; i < maxNoOfCollaterals; i++ ){
        loanIds.push((await vault.getLoanNFTids(alice.address, depositReceipt.address, i)).toNumber());
      }
      //verify they match the NFTs deposited.
      expect(loanIds.indexOf(NFTId)).to.equal(0);
      for (let i = 0; i < maxNoOfCollaterals -1 ; i++){
        await expect(loanIds.indexOf(newNFTIds[i])).to.equal(i+1);
      }
      
      //try to add more collateral NFTs than allowed.
      await depositReceipt.connect(alice).UNSAFEMint(amount2)
      rejectedNFTId = 3 + maxNoOfCollaterals
      await depositReceipt.connect(alice).approve(vault.address, rejectedNFTId)
      await expect(vault.connect(alice).increaseCollateralAmount(depositReceipt.address, rejectedNFTId)).to.be.revertedWith("All NFT slots for loan used");
      
      
    });

    it("Should fail if collateral is paused in CollateralBook", async function () {
      await collateralBook.pauseCollateralType(depositReceipt.address, NFTCode);
      await depositReceipt.connect(alice).approve(vault.address, NFTId2)
      await expect(vault.connect(alice).increaseCollateralAmount(depositReceipt.address, NFTId2)).to.be.revertedWith("Unsupported collateral!");
      
      
    });

    it("Should fail if collateral NFTId is 0", async function () {
      zeroID = 0
      await expect(vault.connect(alice).increaseCollateralAmount(depositReceipt.address, zeroID)).to.be.revertedWith("No zero index NFTs allowed");
      
      
    });

   

    it("Should fail if sender doesn’t own NFT specified", async function () {
      await depositReceipt.connect(bob).approve(vault.address, bobNFT)
      await expect(vault.connect(alice).increaseCollateralAmount(depositReceipt.address, bobNFT)).to.be.revertedWith('Only NFT owner can openLoan');
    });

    
    it("Should fail if sender has no existing loan ", async function () {
      await expect(vault.connect(bob).increaseCollateralAmount(depositReceipt.address, bobNFT)).to.be.revertedWith("No existing collateral!");
    });
    
    it("Should fail if liquidation margin is not met", async function () {
      const lowAmount = ethers.utils.parseEther('1');
      depositReceipt.connect(alice).UNSAFEMint(lowAmount)
      lowValueNFT = 4
      await depositReceipt.connect(alice).approve(vault.address, lowValueNFT)
      //alter liquidation margin to be higher than openingMargin was for this loan
      const MinMargin = ethers.utils.parseEther("3.0");
      const LiqMargin = ethers.utils.parseEther("2.5");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      liq_return = await vault.LIQUIDATION_RETURN();
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest, ZERO_ADDRESS,liq_return.mul(2), VELO); 


      await expect(vault.connect(alice).increaseCollateralAmount(depositReceipt.address, lowValueNFT)).to.be.revertedWith("Liquidation margin not met!");
    });

    it("Should fail if value of NFT sent is zero", async function () {
      depositReceipt.connect(alice).UNSAFEMint(0)
      zeroValueNFT = 4
      await depositReceipt.connect(alice).approve(vault.address, zeroValueNFT)
      await expect(vault.connect(alice).increaseCollateralAmount(depositReceipt.address, zeroValueNFT)).to.be.revertedWith("Zero value added");
    });
    
    
  });
  
  describe("CloseLoans", function () {
    const fullValue = e18;
    const NOT_OWNED = 999;
    let loanTaken

    beforeEach(async function () {
      const NFTId = 1;
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      loanTaken = collateralUsed.div(2)
      await depositReceipt.connect(alice).approve(vault.address, NFTId)
      await expect(vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken, NFTCode,collateralUsed );
      
      //then we make another loan with a different user 
      // for the purposes of nullifying the impact
      // of the openLoanFee and time elapsed interest due.
      amount = ethers.utils.parseEther('600');
      await depositReceipt.connect(bob).UNSAFEMint(amount)
      const NFTId2 = 2
      const pooledTokens2 = await depositReceipt.pooledTokens(NFTId2)
      const collateralUsed2 = await depositReceipt.priceLiquidity(pooledTokens2)
      const loanTaken2 = collateralUsed2.div(2)
      await depositReceipt.connect(bob).approve(vault.address, NFTId2)
      await vault.connect(bob).openLoan(depositReceipt.address, NFTId2, loanTaken2, addingCollateral);

      const transferAmount = await isoUSD.balanceOf(bob.address);
      await isoUSD.connect(bob).transfer(alice.address, transferAmount );  
        
    });

    it("Should return user collateral NFT if valid conditions are met and emit ClosedLoan event", async function () {
      const NFTId = 1;
      let timeJump = timeSkipRequired(1.01);
      await cycleVirtualPrice(timeJump, depositReceipt);
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      
      let valueClosing = realDebt.mul(virtualPrice).div(e18);
      //now we add a hack to repay the $0.002 that is annoyingly leftover
      valueClosing = valueClosing.add(ethers.utils.parseEther('0.002'))

      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const beforeTreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      //zero for partial percentage 4th arg as we aren't using it here
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.emit(vault, 'ClosedLoanNFT').withArgs(alice.address, valueClosing, NFTCode, collateralUsed);
      
      //a fully paid loan should repay all principle
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(0)

      //a fully repaid loan should repay all interest also, minus dust
      const totalLoan = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      let error = totalLoanBefore.div(100000) //0.001%
      expect(totalLoan).to.be.closeTo(zero, error)
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(alice.address)
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing))

      //check the fees accumulated in the treasury
      const TreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      let TreasuryisoUSDDifference = TreasuryisoUSDBalance.sub(beforeTreasuryisoUSDBalance)
      let expectedFees = valueClosing.sub(loanTaken)
      expect(TreasuryisoUSDDifference).to.equal(expectedFees)

      const afterNFTowner = await depositReceipt.ownerOf(NFTId)
      expect(afterNFTowner).to.equal(alice.address)
    });

    it("Should return user NFT for a successful closeLoan call regardless of NFT ID", async function () {
      
      for(let i =0; i < 8; i++){
        await depositReceipt.connect(alice).UNSAFEMint(amount)
      }
      const NFTId = 10;
      let newPooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralAdding = await depositReceipt.priceLiquidity(newPooledTokens)


      await depositReceipt.connect(alice).approve(vault.address, NFTId)
      await expect(vault.connect(alice).openLoan(depositReceipt.address, NFTId, 0, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, 0, NFTCode, collateralAdding );

      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      
      let valueClosing = realDebt.mul(virtualPrice).div(e18);

      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      //IDs passed in slots relating to NOT_OWNED are disregarded
      let NFT_slot = 1
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[NFT_slot,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      //zero for partial percentage 4th arg as we aren't using it here

      //check removing a collateral updates the registered collateral loans Ids mapping right.
      loan_ids = []

      for(i =0; i < 8; i++){
        loan_ids.push(await vault.getLoanNFTids(alice.address,depositReceipt.address,i))
      }
      
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.emit(vault, 'ClosedLoanNFT').withArgs(alice.address, valueClosing, NFTCode, collateralUsed);
      
      after_loan_ids = [] 
      for(i =0; i < 8; i++){
        after_loan_ids.push(await vault.getLoanNFTids(alice.address,depositReceipt.address,i))
      }

      //a fully paid loan should repay all principle
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(0)

      //a fully repaid loan should repay all interest also, minus dust
      const totalLoan = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      let error = totalLoanBefore.div(100000) //0.001%
      expect(totalLoan).to.be.closeTo(zero, error)
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(alice.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));

      const afterNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(afterNFTowner).to.equal(alice.address);

      //Final check, check only the NFT slot relating to the NFT we removed has been reset.
      for(i =0; i < 8; i++){
        if(i != NFT_slot){
          expect(after_loan_ids[i]).to.equal(loan_ids[i])
        }
        else{
          expect(after_loan_ids[i]).to.equal(0)
        }
        
      }
    });
    
    
    it("Should allow reducing margin ratio if in excess by drawing out collateral", async function () {
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18);
      const requestedNFTId = 1;
      const NFTId3 = 3;
      const amount = ethers.utils.parseEther('1100');

      //mint a new NFT to use as loan collateral
      await depositReceipt.connect(alice).UNSAFEMint(amount)
      await depositReceipt.connect(alice).approve(vault.address,NFTId3);

      //increase loan collateral without taking extra loan
      await vault.connect(alice).openLoan(depositReceipt.address,NFTId3, 0, addingCollateral);
      
      const beforeNFTowner = await depositReceipt.ownerOf(requestedNFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      const beforeNFTowner3 = await depositReceipt.ownerOf(NFTId3);
      expect(beforeNFTowner3).to.equal(vault.address);

      const principleBefore = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)

      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const pooledTokens = await depositReceipt.pooledTokens(requestedNFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)

      const collateralNFTs = [[requestedNFTId,9,9,9,9,9,9,9,],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED,NOT_OWNED, NOT_OWNED,NOT_OWNED,NOT_OWNED]];
      // close loan call
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, 0, 0)).to.emit(vault, 'ClosedLoanNFT').withArgs(alice.address, 0, NFTCode, collateralUsed);
      
      //if no loan is repaid then the principle owed should stay the same 
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(principleBefore)
 
      //if no loan is repaid then the loan and interest owed should stay the same 
      const totalLoan = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      expect(totalLoan).to.equal(totalLoanBefore)

      const finalisoUSDBalance = await isoUSD.balanceOf(alice.address);
      expect(finalisoUSDBalance).to.equal(beforeisoUSDBalance);

      const afterNFTowner = await depositReceipt.ownerOf(requestedNFTId);
      expect(afterNFTowner).to.equal(alice.address);

      const afterNFTowner3 = await depositReceipt.ownerOf(NFTId3);
      expect(afterNFTowner3).to.equal(vault.address);
      
    });

    it("Should allow partial closure of loan if valid conditions are met", async function () {
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18).div(4);
      const requestedNFTId = 1;
      const NFTId3 = 3;
      //value less than first used NFT so we must repay some of the loan as we withdraw the first NFT
      amount = ethers.utils.parseEther('800');

      //mint a new NFT to use as loan collateral
      await depositReceipt.connect(alice).UNSAFEMint(amount)
      await depositReceipt.connect(alice).approve(vault.address,NFTId3);
      const pooledTokens3 = await depositReceipt.pooledTokens(NFTId3)
      const collateralUsed3 = await depositReceipt.priceLiquidity(pooledTokens3)
      
      //increase loan collateral without taking extra loan
      await vault.connect(alice).openLoan(depositReceipt.address,NFTId3, 0, addingCollateral);
      
      const beforeNFTowner = await depositReceipt.ownerOf(requestedNFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      const beforeNFTowner3 = await depositReceipt.ownerOf(NFTId3);
      expect(beforeNFTowner3).to.equal(vault.address);
      
      //store data to compare to after closeLoan
      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const beforeTreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      const pooledTokens = await depositReceipt.pooledTokens(requestedNFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const principleBefore = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)

      //first try requesting NFT back with no loan repaid.
      await isoUSD.connect(alice).approve(vault.address, valueClosing)
      const collateralNFTs = [[requestedNFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED,NOT_OWNED, NOT_OWNED,NOT_OWNED,NOT_OWNED]];
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, 0, 0)).to.revertedWith("Remaining debt fails to meet minimum margin!")
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.emit(vault, 'ClosedLoanNFT').withArgs(alice.address, valueClosing, NFTCode, collateralUsed);
      
      //the principle should partial decrease 
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(principleBefore.sub(valueClosing))

      
      //no interest is paid but the partial principle decrease should be reflected
      let virtualPriceAfter = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const totalLoan = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      const expectedTotalLoan = totalLoanBefore.sub(valueClosing.mul(base).div(virtualPriceAfter))
      expect(totalLoan).to.equal(expectedTotalLoan)

      //as we have paid no interest there should be no fee paid to the treasury yet
      const TreasuryisoUSDBalance = await isoUSD.balanceOf(treasury.address)
      expect(TreasuryisoUSDBalance).to.equal(beforeTreasuryisoUSDBalance)


      const finalisoUSDBalance = await isoUSD.balanceOf(alice.address);
      expect(finalisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));

      const afterNFTowner = await depositReceipt.ownerOf(requestedNFTId);
      expect(afterNFTowner).to.equal(alice.address);

      const afterNFTowner3 = await depositReceipt.ownerOf(NFTId3);
      expect(afterNFTowner3).to.equal(vault.address);
    });
    
    it("Should allow splitting an NFT value for return to user if valid conditions are met", async function () {
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18).div(4);
      const requestedNFTId = 1;
      const NFTId3 = 3;
      const newNFTId = NFTId3 +1;
      //value less than first used NFT so we can only partially withdraw first NFT
      amount = ethers.utils.parseEther('800');

      //mint a new NFT to use as loan collateral
      await depositReceipt.connect(alice).UNSAFEMint(amount)
      await depositReceipt.connect(alice).approve(vault.address,NFTId3)

      //increase loan collateral without taking extra loan
      await vault.connect(alice).openLoan(depositReceipt.address,NFTId3, 0, addingCollateral)

      const beforeNFTowner = await depositReceipt.ownerOf(requestedNFTId)
      expect(beforeNFTowner).to.equal(vault.address)

      const beforeNFTowner3 = await depositReceipt.ownerOf(NFTId3)
      expect(beforeNFTowner3).to.equal(vault.address)
      
      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const collateralNFTs = [[9,9,9,9,9,9,9,requestedNFTId],[NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      const partialPercentage = e18.div(4); //25%
      const pooledTokens = await depositReceipt.pooledTokens(requestedNFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const capitalReturned = collateralUsed.mul(partialPercentage).div(e18)
      const principleBefore = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)

      await isoUSD.connect(alice).approve(vault.address, valueClosing)
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, partialPercentage)).to.emit(vault, 'ClosedLoanNFT').withArgs(alice.address, valueClosing, NFTCode, capitalReturned);
      
      //the principle should partial decrease 
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(principleBefore.sub(valueClosing))

      //no interest is paid but the partial principle decrease should be reflected
      let virtualPriceAfter = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address)
      const totalLoan = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      const expectedTotalLoan = totalLoanBefore.sub(valueClosing.mul(base).div(virtualPriceAfter))
      expect(totalLoan).to.equal(expectedTotalLoan)

      const finalisoUSDBalance = await isoUSD.balanceOf(alice.address)
      expect(finalisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing))

      //check NFT ownerships are as expected
      const afterNFTowner = await depositReceipt.ownerOf(requestedNFTId)
      expect(afterNFTowner).to.equal(vault.address)

      const afterNFTowner3 = await depositReceipt.ownerOf(NFTId3)
      expect(afterNFTowner3).to.equal(vault.address)

      const newNFTowner = await depositReceipt.ownerOf(newNFTId)
      expect(newNFTowner).to.equal(alice.address)

      //check details of new generated NFT
      const newPooledTokens = await depositReceipt.pooledTokens(newNFTId)
      const newNFTValue = await depositReceipt.priceLiquidity(newPooledTokens)
      expect(newNFTValue).to.equal(capitalReturned)
    });

     
    it("Should allow partial closure of loan with no collateral repaid to user", async function () {
      const NFTId = 1;
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18).div(4);

      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      const NoCollateralUsed = 0;
      const principleBefore = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)

      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[9,9,9,9,9,9,9,9],[NOT_OWNED,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      //zero for partial percentage 4th arg as we aren't using it here
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.emit(vault, 'ClosedLoanNFT').withArgs(alice.address, valueClosing, NFTCode, NoCollateralUsed);
      
      //the principle should partial decrease 
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(principleBefore.sub(valueClosing))

      //no interest is paid but the partial principle decrease should be reflected
      let virtualPriceAfter = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const totalLoan = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      const expectedTotalLoan = totalLoanBefore.sub(valueClosing.mul(base).div(virtualPriceAfter))
      expect(totalLoan).to.equal(expectedTotalLoan)

      const AfterisoUSDBalance = await isoUSD.balanceOf(alice.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));

      const afterNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(afterNFTowner).to.equal(vault.address);
    });

    //we ignore debts less than $0.001, fine tune this lower for less risk. 
    it("Should succeed to close loan if only dust is left", async function () {
      const NFTId = 1;
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      //remove a tiny amount of the repayment ( 10^(-12) isoUSD)
      const dust = ethers.utils.parseEther('0.000001');
      let valueClosing = (realDebt.mul(virtualPrice).div(e18)).sub(dust);

      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);
      

      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const totalLoanBefore = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      
      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      //zero for partial percentage 4th arg as we aren't using it here
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.emit(vault, 'ClosedLoanNFT').withArgs(alice.address, valueClosing, NFTCode, collateralUsed);
      
      //a fully paid loan should repay all principle
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.be.closeTo(zero, TENTH_OF_CENT)

      //a fully repaid loan should repay all interest also, minus dust
      const totalLoan = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address)
      let error = totalLoanBefore.div(100000) //0.001%
      expect(totalLoan).to.be.closeTo(zero, error)

      const AfterisoUSDBalance = await isoUSD.balanceOf(alice.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(valueClosing));

      const afterNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(afterNFTowner).to.equal(alice.address);
    });

    it("Should fail to close if the contract is paused", async function () {
      const NFTId = 1;
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      
      let valueClosing = realDebt.mul(virtualPrice).div(e18);
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      //zero for partial percentage 4th arg as we aren't using it here
      await vault.pause();
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.be.revertedWith("Pausable: paused");     
    });
    
    it("Should fail if collateral partialPercentage is greater than 100%", async function () {
      const NFTId = 1;
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      
      let valueClosing = realDebt.mul(virtualPrice).div(e18);
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[9,9,9,9,9,9,9,NFTId],[NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      //partial percentage greater than 100% (1 ETH)
      const partialPercentage = ethers.utils.parseEther('1.01');
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, partialPercentage)).to.be.revertedWith("partialPercentage greater than 100%");     
    });

    //add test checking behaviour if NFT is in a different slot to 4th slot but partialPercentage is active?

    it("Should fail if collateral partialPercentage requested is exceeds margin requirement", async function () {
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18).div(2);
      const requestedNFTId = 1;
      const partialPercentage = ethers.utils.parseEther('0.95');
      
      //repay 50% of loan but request 95% of NFT value back
      const collateralNFTs = [[9,9,9,9,9,9,9, requestedNFTId],[NOT_OWNED, NOT_OWNED,NOT_OWNED,NOT_OWNED, NOT_OWNED,NOT_OWNED,NOT_OWNED, 0]];
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, partialPercentage)).to.revertedWith("Remaining debt fails to meet minimum margin!")
         
    });

    it("Should fail to close if collateral is paused in CollateralBook", async function () {
      const NFTId = 1;
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      
      let valueClosing = realDebt.mul(virtualPrice).div(e18);
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      //zero for partial percentage 4th arg as we aren't using it here
      await collateralBook.pauseCollateralType(depositReceipt.address, NFTCode);
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.be.revertedWith("Unsupported collateral!");     
    });


    it("Should fail to close if an invalid collateral is used", async function () {
      const NFTId = 1;
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      
      let valueClosing = realDebt.mul(virtualPrice).div(e18);
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      //zero for partial percentage 4th arg as we aren't using it here
      await expect(vault.connect(alice).closeLoan(bob.address, collateralNFTs, valueClosing, 0)).to.be.revertedWith("Unsupported collateral!");     
    });

    it("Should fail to close if user asks for an NFT already withdrawn", async function () {
      const requestedNFTId = 1;
      const NFTId3 = 3;
      //value less than first used NFT so we must repay some of the loan as we withdraw the first NFT
      amount = ethers.utils.parseEther('2000');
      //mint a new NFT to use as loan collateral
      await depositReceipt.connect(alice).UNSAFEMint(amount)
      await depositReceipt.connect(alice).approve(vault.address,NFTId3);
      //increase loan collateral without taking extra loan
      await vault.connect(alice).openLoan(depositReceipt.address,NFTId3, 0, addingCollateral);
      const beforeNFTowner = await depositReceipt.ownerOf(requestedNFTId);
      const beforeNFTowner3 = await depositReceipt.ownerOf(NFTId3);
      expect(beforeNFTowner).to.equal(vault.address);
      expect(beforeNFTowner3).to.equal(vault.address);
      
      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const pooledTokens = await depositReceipt.pooledTokens(requestedNFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      //first try requesting NFT back with no loan repaid.
      const collateralNFTs = [[requestedNFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED,NOT_OWNED, NOT_OWNED,NOT_OWNED,NOT_OWNED]];
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, 0, 0)).to.emit(vault, 'ClosedLoanNFT').withArgs(alice.address, 0, NFTCode, collateralUsed);
      const finalisoUSDBalance = await isoUSD.balanceOf(alice.address);
      expect(finalisoUSDBalance).to.equal(beforeisoUSDBalance);
      const afterNFTowner = await depositReceipt.ownerOf(requestedNFTId);
      const afterNFTowner3 = await depositReceipt.ownerOf(NFTId3);
      expect(afterNFTowner).to.equal(alice.address);
      expect(afterNFTowner3).to.equal(vault.address);

      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, 0, 0)).to.be.revertedWith("Incorrect NFT details inputted")
    });

    it("Should fail to close if user has insufficient isoUSD", async function () {
      const NFTId = 1;
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18);

      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      //remove most of isoUSD from alice's account
      await isoUSD.connect(alice).transfer(bob.address, valueClosing);
      const NoCollateralUsed = 0;
      await isoUSD.connect(alice).approve(vault.address, valueClosing)
      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      //zero for partial percentage 4th arg as we aren't using it here
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.be.revertedWith("ERC20: transfer amount exceeds balance"); 
    });

    it("Should fail to close if user tries to return more isoUSD than borrowed originally", async function () {
      const NFTId = 1;
      const valueClosing = await isoUSD.balanceOf(alice.address)

      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      
      const NoCollateralUsed = 0;
      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      //zero for partial percentage 4th arg as we aren't using it here
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.be.revertedWith("Trying to return more isoUSD than borrowed!");
    
    });
    
    
    it("Should fail to close if user tried to take back collateral and repay nothing or not enough", async function () {
      const NFTId = 1;
      let realDebt = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      let virtualPrice = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const valueClosing = realDebt.mul(virtualPrice).div(e18).mul(87).div(100);

      const beforeisoUSDBalance = await isoUSD.balanceOf(alice.address);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);
      await isoUSD.connect(alice).approve(vault.address, valueClosing);
      
      const NoCollateralUsed = 0;
      //IDs passed in slots relating to NOT_OWNED are disregarded
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      //zero for partial percentage 4th arg as we aren't using it here
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, 0, 0)).to.be.revertedWith('Remaining debt fails to meet minimum margin!');
      
      await expect(vault.connect(alice).closeLoan(depositReceipt.address, collateralNFTs, valueClosing, 0)).to.be.revertedWith('Remaining debt fails to meet minimum margin!');
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

    const NOT_OWNED = 999;

    beforeEach(async function () {
      liq_return = await vault.LIQUIDATION_RETURN();
      const MinMargin = ethers.utils.parseEther("1.001"); //1.001^180 i.e. 3 mins continiously compounding per second
      const LiqMargin = ethers.utils.parseEther("1.0");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest,ZERO_ADDRESS, liq_return.mul(2), VELO);

      const NFTId = 1;
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const collateralUsed = await depositReceipt.priceLiquidity(pooledTokens)
      const loanTaken = collateralUsed.mul(999).div(1000)
      await depositReceipt.connect(alice).approve(vault.address, NFTId)
      await expect(vault.connect(alice).openLoan(depositReceipt.address, NFTId, loanTaken, addingCollateral)).to.emit(vault, 'OpenOrIncreaseLoanNFT').withArgs(alice.address, loanTaken, NFTCode,collateralUsed );
      //then we make another loan with a different user who will be the liquidator and so needs isoUSD
      amount = ethers.utils.parseEther('2600');
      await depositReceipt.connect(bob).UNSAFEMint(amount)
      const NFTId2 = 2
      const pooledTokens2 = await depositReceipt.pooledTokens(NFTId2)
      const collateralUsed2 = await depositReceipt.priceLiquidity(pooledTokens2)
      const loanTaken2 = collateralUsed2.div(2)
      await depositReceipt.connect(bob).approve(vault.address, NFTId2)
      await vault.connect(bob).openLoan(depositReceipt.address, NFTId2, loanTaken2, addingCollateral);

      //reset collateral options back to normal
      const MinMargin3 = ethers.utils.parseEther("2.0");
      const LiqMargin3 = ethers.utils.parseEther("1.1");
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin3, LiqMargin3, Interest, ZERO_ADDRESS, liq_return.mul(2), VELO); //fake LIQ_RETURN used for ease of tests
    });

    it("Should liquidate if entire loan is eligible to liquidate and emit LiquidationNFT & BadDebtClearedNFT events", async function () {
      const NFTId = 1;
      const beforeisoUSDBalance = await isoUSD.balanceOf(bob.address);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      
      //modify minimum collateral ratio to enable full liquidation
      const MinMargin = ethers.utils.parseEther("14.0");
      const LiqMargin = ethers.utils.parseEther("7.0");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      liq_return = await vault.LIQUIDATION_RETURN();
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest, ZERO_ADDRESS,liq_return.mul(2),VELO); 
      const virtualPriceBegin= await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const totalCollateralinUSD = await depositReceipt.priceLiquidity(pooledTokens)
      const proposedLiquidationAmount = totalCollateralinUSD; //in this case they are the same
      //isoUSD being returned
      const amountLiquidated = totalCollateralinUSD.mul((e18.sub(liquidatorFee))).div(e18)
      
      const virtualDebtBegin = await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address);
      //approve vault to take isoUSD from liquidator and call liquidation
      await isoUSD.connect(bob).approve(vault.address, amountLiquidated)
      //NFTs being sent to liquidator, only first slot is being used
      const collateralNFTs = [[NFTId,9,9,9,9,9,9,9],[0,NOT_OWNED, NOT_OWNED,NOT_OWNED,NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED]];
      const call = await vault.connect(bob).callLiquidation(alice.address, depositReceipt.address, collateralNFTs, e18);
      expect(call).to.emit(vault, 'LiquidationNFT').withArgs(alice.address, bob.address, amountLiquidated, NFTCode, proposedLiquidationAmount);
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(bob.address);
      expect(AfterisoUSDBalance).to.equal(beforeisoUSDBalance.sub(amountLiquidated)); 

      const afterNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(afterNFTowner).to.equal(bob.address);

      const virtualPriceEnd = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const realDebt = Math.floor((await vault.isoUSDLoanAndInterest(depositReceipt.address, alice.address))*virtualPriceEnd/ e18);
      expect(realDebt).to.equal(0);

      //as we have a bad debt the principle is reset to 0
      const principle = await vault.isoUSDLoaned(depositReceipt.address, alice.address)
      expect(principle).to.equal(0);

      const badDebtQuantity = (virtualDebtBegin.mul(virtualPriceEnd).div(e18)).sub(amountLiquidated);
      for(let i =0; i < 8; i++){
        // all loan slots ought to be default value 0 now
        const id = await vault.getLoanNFTids(alice.address,depositReceipt.address, i)
        expect(id).to.equal(0);

      }
      
      expect(call).to.emit(vault, 'BadDebtClearedNFT').withArgs(alice.address, bob.address, badDebtQuantity, NFTCode);
      
    });

    

    it("Should partially liquidate loan if possible and emit Liquidation event", async function () {
      //here the liquidator and loan holders swap roles as alice loan is impossible to 
      //partially liquidate as collat value ~= loan.
      //we allow for 0.001% deviation in some recorded terms due to inaccuracies caused by USDC valuation being only to 6dp.
      const loanHolder = bob.address;
      const liquidator = alice.address;

      //id of loan NFT associated to bob
      const NFTId = 2;
      //check NFT ownership and set up beginning isoUSD balance for later checks
      const beforeisoUSDBalance = await isoUSD.balanceOf(liquidator);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      
      //modify minimum collateral ratio to enable partial liquidation
      const MinMargin = ethers.utils.parseEther("3.0");
      const LiqMargin = ethers.utils.parseEther("2.5");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      liq_return = await vault.LIQUIDATION_RETURN();
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest, ZERO_ADDRESS,liq_return.mul(2), VELO); 

      const virtualPriceBegin = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const totalCollateralinUSD = await depositReceipt.priceLiquidity(pooledTokens)

      
      const virtualDebtBegin = await vault.isoUSDLoanAndInterest(depositReceipt.address, loanHolder);
      const oneDollar = ethers.utils.parseEther("1.0");
      const loanSizeInisoUSD = virtualPriceBegin.mul(virtualDebtBegin).div(e18);
      const collateralPosted = ethers.utils.parseEther("2600");
      const valuePerCollateral = totalCollateralinUSD.mul(e18).div(collateralPosted)
      const proposedLiquidationAmount = await vault.viewLiquidatableAmount(collateralPosted, valuePerCollateral, loanSizeInisoUSD, LiqMargin)
      const principleBefore = await vault.isoUSDLoaned(depositReceipt.address, loanHolder)

      const partialPercentage = proposedLiquidationAmount.mul(e18).div(totalCollateralinUSD);
      const amountLiquidated = proposedLiquidationAmount.mul((e18.sub(liquidatorFee))).div(e18)
      
      //because this is a partial liquidation the NFT must go in the final slot to use the partialPercentage field
      //non-used slots can have any NFT id so long as they aren't owned by the loanHolder so here we use #9.
      const collateralNFTs = [[9,9,9,9,9,9,9,NFTId],[NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      //call the liquidation
      await isoUSD.connect(alice).approve(vault.address, amountLiquidated)
      const call = await vault.connect(alice).callLiquidation(loanHolder, depositReceipt.address, collateralNFTs, partialPercentage);
      
      //check for LiquidationNFT event emission, sub 1 for rounding errors
      expect(call).to.emit(vault, 'LiquidationNFT').withArgs(loanHolder, liquidator, amountLiquidated.sub(1), NFTCode, proposedLiquidationAmount.sub(1));
      
      const AfterisoUSDBalance = await isoUSD.balanceOf(liquidator);
      //allow 0.001% deviation
      const error = AfterisoUSDBalance.div(100000)
      expect(AfterisoUSDBalance).to.be.closeTo(beforeisoUSDBalance.sub(amountLiquidated),error); 
      
      const afterNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(afterNFTowner).to.equal(vault.address);

      //partial liquidation splits the NFT and sends the new certId to the liquidator
      const newNFTowner = await depositReceipt.ownerOf(NFTId+1);
      expect(newNFTowner).to.equal(liquidator);
      
      const newNFTPooledTokens = await depositReceipt.pooledTokens(NFTId+1)
      const expectedNewPooledTokens = pooledTokens.mul(partialPercentage).div(e18)
      expect(newNFTPooledTokens).to.equal(expectedNewPooledTokens)

      const newNFTValue = await depositReceipt.priceLiquidity(newNFTPooledTokens)
      const expectedNFTValue = proposedLiquidationAmount
      //allow 0.001% deviation
      const error2 = newNFTValue.div(100000)
      expect(newNFTValue).to.be.closeTo(expectedNFTValue, error2)

      const principle = await vault.isoUSDLoaned(depositReceipt.address, loanHolder)
      //allow 0.00001% deviation
      let error3 = principle.div(10000000)
      expect(principle).to.be.closeTo(principleBefore.sub(amountLiquidated),error3); //rounding error again

      const virtualPriceEnd = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const realDebt = (await vault.isoUSDLoanAndInterest(depositReceipt.address, loanHolder)).mul(virtualPriceEnd).div(e18);
      const isoUSDreturning = totalCollateralinUSD * liquidatorFee; //adjustment for liquidation bonus of 5% 
      //allow 0.001% deviation
      const error4 = realDebt.div(100000)
      expect(realDebt).to.be.closeTo(loanSizeInisoUSD.sub(amountLiquidated),error4);
      const expectedLoanCollat = totalCollateralinUSD.sub(proposedLiquidationAmount);
      
      const oldNFTPooledTokens = await depositReceipt.pooledTokens(NFTId)
      const oldNFTValue = await depositReceipt.priceLiquidity(oldNFTPooledTokens)
      //allow 0.001% deviation
      const error5 = oldNFTValue.div(100000)
      expect(oldNFTValue).to.be.closeTo(expectedLoanCollat, error5);
      
      for(let i =0; i < 4; i++){
        // all loan slots should not have changed as original NFT remains in loan collat
        const id = await vault.getLoanNFTids(loanHolder,depositReceipt.address, i)
        if(id != NFTId){
          expect(id).to.equal(0);
        }
        else{ 
          expect(id).to.equal(NFTId);
        }

      }
    });
        

    it("Should revert if liquidator lacks isoUSD to repay debt", async function () {
      //here the liquidator and loan holders swap roles as alice loan is impossible to 
      //partially liquidate as collat value ~= loan.
      //we allow for 0.001% deviation in some recorded terms due to inaccuracies caused by USDC valuation being only to 6dp.
      const loanHolder = bob.address;
      const liquidator = alice.address;

      //id of loan NFT associated to bob
      const NFTId = 2;
      //check NFT ownership and set up beginning isoUSD balance for later checks
      const beforeisoUSDBalance = await isoUSD.balanceOf(liquidator);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      
      //modify minimum collateral ratio to enable partial liquidation
      const MinMargin = ethers.utils.parseEther("3.0");
      const LiqMargin = ethers.utils.parseEther("2.5");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      liq_return = await vault.LIQUIDATION_RETURN();
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest, ZERO_ADDRESS,liq_return.mul(2), VELO); 

      const virtualPriceBegin = await collateralBook.viewVirtualPriceforAsset(depositReceipt.address);
      const pooledTokens = await depositReceipt.pooledTokens(NFTId)
      const totalCollateralinUSD = await depositReceipt.priceLiquidity(pooledTokens)

      
      const virtualDebtBegin = await vault.isoUSDLoanAndInterest(depositReceipt.address, loanHolder);
      const oneDollar = ethers.utils.parseEther("1.0");
      const loanSizeInisoUSD = virtualPriceBegin.mul(virtualDebtBegin).div(e18);
      const collateralPosted = ethers.utils.parseEther("2600");
      const valuePerCollateral = totalCollateralinUSD.mul(e18).div(collateralPosted)
      const proposedLiquidationAmount = await vault.viewLiquidatableAmount(collateralPosted, valuePerCollateral, loanSizeInisoUSD, LiqMargin)
      
      const partialPercentage = proposedLiquidationAmount.mul(e18).div(totalCollateralinUSD);
      const amountLiquidated = proposedLiquidationAmount.mul((e18.sub(liquidatorFee))).div(e18)
      
      //because this is a partial liquidation the NFT must go in the final slot to use the partialPercentage field
      //non-used slots can have any NFT id so long as they aren't owned by the loanHolder so here we use #9.
      const collateralNFTs = [[9,9,9,9,9,9,9,NFTId],[NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      //call the liquidation
      const amount = await isoUSD.balanceOf(alice.address)
      await isoUSD.connect(alice).transfer(bob.address, amount)
      await isoUSD.connect(alice).approve(vault.address, amount)
      await expect(vault.connect(alice).callLiquidation(loanHolder, depositReceipt.address, collateralNFTs, partialPercentage)).to.be.revertedWith("ERC20: transfer amount exceeds balance");

    });
       

    it("Should fail if system is paused", async function () {
      //here the liquidator and loan holders swap roles as alice loan is impossible to 
      //partially liquidate as collat value ~= loan.
      //we allow for 0.001% deviation in some recorded terms due to inaccuracies caused by USDC valuation being only to 6dp.
      const loanHolder = bob.address;
      const liquidator = alice.address;

      //id of loan NFT associated to bob
      const NFTId = 2;
      //check NFT ownership and set up beginning isoUSD balance for later checks
      const beforeisoUSDBalance = await isoUSD.balanceOf(liquidator);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      
      //modify minimum collateral ratio to enable partial liquidation
      const MinMargin = ethers.utils.parseEther("3.0");
      const LiqMargin = ethers.utils.parseEther("2.5");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      liq_return = await vault.LIQUIDATION_RETURN();
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest, ZERO_ADDRESS,liq_return.mul(2), VELO);  

      //non-used slots can have any NFT id so long as they aren't owned by the loanHolder so here we use #9.
      const collateralNFTs = [[9,9,9,9,9,9,9,NFTId],[NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      //pause the vault with owner
      await vault.connect(owner).pause()
      //call the liquidation
      await expect(vault.connect(alice).callLiquidation(loanHolder, depositReceipt.address, collateralNFTs, e18)).to.be.revertedWith("Pausable: paused");


    });

    it("Should fail to liquidate if the collateral token is unsupported", async function () {
      const loanHolder = bob.address;
      const liquidator = alice.address;

      //id of loan NFT associated to bob
      const NFTId = 2;
      //check NFT ownership and set up beginning isoUSD balance for later checks
      const beforeisoUSDBalance = await isoUSD.balanceOf(liquidator);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      
      //modify minimum collateral ratio to enable partial liquidation
      const MinMargin = ethers.utils.parseEther("3.0");
      const LiqMargin = ethers.utils.parseEther("2.5");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      liq_return = await vault.LIQUIDATION_RETURN();
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest, ZERO_ADDRESS,liq_return.mul(2), VELO);  

      //non-used slots can have any NFT id so long as they aren't owned by the loanHolder so here we use #9.
      const collateralNFTs = [[9,9,9,9,9,9,9,NFTId],[NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      //call the liquidation
      await expect(vault.connect(alice).callLiquidation(loanHolder, bob.address, collateralNFTs, e18)).to.be.revertedWith("Unsupported collateral!");

    });
    
    it("Should fail to liquidate if the collateral is paused in CollateralBook", async function () {
      const loanHolder = bob.address;
      const liquidator = alice.address;

      //id of loan NFT associated to bob
      const NFTId = 2;
      //check NFT ownership and set up beginning isoUSD balance for later checks
      const beforeisoUSDBalance = await isoUSD.balanceOf(liquidator);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      
      //modify minimum collateral ratio to enable partial liquidation
      const MinMargin = ethers.utils.parseEther("3.0");
      const LiqMargin = ethers.utils.parseEther("2.5");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      liq_return = await vault.LIQUIDATION_RETURN();
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest, ZERO_ADDRESS,liq_return.mul(2), VELO);  

      //pause collateral in collateral book
      await collateralBook.pauseCollateralType(depositReceipt.address, NFTCode);
      //non-used slots can have any NFT id so long as they aren't owned by the loanHolder so here we use #9.
      const collateralNFTs = [[9,9,9,9,9,9,9,NFTId],[NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      //call the liquidation
      await expect(vault.connect(alice).callLiquidation(loanHolder, depositReceipt.address, collateralNFTs, e18)).to.be.revertedWith("Unsupported collateral!");      
    });


    it("Should fail to liquidate if the collateral token is not set", async function () {
      const loanHolder = bob.address;
      const liquidator = alice.address;

      //id of loan NFT associated to bob
      const NFTId = 2;
      //check NFT ownership and set up beginning isoUSD balance for later checks
      const beforeisoUSDBalance = await isoUSD.balanceOf(liquidator);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      
      //modify minimum collateral ratio to enable partial liquidation
      const MinMargin = ethers.utils.parseEther("3.0");
      const LiqMargin = ethers.utils.parseEther("2.5");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      liq_return = await vault.LIQUIDATION_RETURN();
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest, ZERO_ADDRESS,liq_return.mul(2), VELO);  

     
      //non-used slots can have any NFT id so long as they aren't owned by the loanHolder so here we use #9.
      const collateralNFTs = [[9,9,9,9,9,9,9,NFTId],[NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      //call the liquidation
      await expect(vault.connect(alice).callLiquidation(loanHolder, ZERO_ADDRESS, collateralNFTs, e18)).to.be.revertedWith("Unsupported collateral!");      
    });

    it("Should fail to liquidate if the debtor address is not set", async function () {
      const loanHolder = bob.address;
      const liquidator = alice.address;

      //id of loan NFT associated to bob
      const NFTId = 2;
      //check NFT ownership and set up beginning isoUSD balance for later checks
      const beforeisoUSDBalance = await isoUSD.balanceOf(liquidator);
      const beforeNFTowner = await depositReceipt.ownerOf(NFTId);
      expect(beforeNFTowner).to.equal(vault.address);

      
      //modify minimum collateral ratio to enable partial liquidation
      const MinMargin = ethers.utils.parseEther("3.0");
      const LiqMargin = ethers.utils.parseEther("2.5");
      const Interest = ethers.utils.parseEther((threeMinInterest/100000000).toString(10), "ether")
      liq_return = await vault.LIQUIDATION_RETURN();
      await collateralBook.TESTchangeCollateralType(depositReceipt.address, NFTCode, MinMargin, LiqMargin, Interest, ZERO_ADDRESS,liq_return.mul(2), VELO);  

     
      //non-used slots can have any NFT id so long as they aren't owned by the loanHolder so here we use #9.
      const collateralNFTs = [[9,9,9,9,9,9,9,NFTId],[NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      //call the liquidation
      await expect(vault.connect(alice).callLiquidation(ZERO_ADDRESS, depositReceipt.address, collateralNFTs, e18)).to.be.revertedWith("Zero address used");      
    });

    it("Should fail to liquidate if flagged loan isn't at liquidatable margin level", async function () {
      const loanHolder = bob.address;
      const liquidator = alice.address;

      //id of loan NFT associated to bob
      const NFTId = 2;
     
      //non-used slots can have any NFT id so long as they aren't owned by the loanHolder so here we use #9.
      const collateralNFTs = [[9,9,9,9,9,9,9,NFTId],[NOT_OWNED,NOT_OWNED, NOT_OWNED, NOT_OWNED, NOT_OWNED,NOT_OWNED, NOT_OWNED,0]];
      //call the liquidation
      await expect(vault.connect(alice).callLiquidation(loanHolder, depositReceipt.address, collateralNFTs, e18)).to.be.revertedWith("Loan not liquidatable");      
    });
  

  });

  describe("setDailyMax", function () {
    beforeEach(async function () {
       
    });
    it("Should not allow anyone to call it", async function () {
      await expect( vault.connect(bob).setDailyMax(12)).to.be.revertedWith("Caller is not an admin"); 
    });
    it("Should succeed when called by owner with values smaller than $100 million", async function () {
      const million = ethers.utils.parseEther("1000000");
      const oldMax = await vault.dailyMax();
      expect( await vault.connect(owner).setDailyMax(million)).to.emit(vault, 'ChangeDailyMax').withArgs(million, oldMax); 
      expect( await vault.connect(owner).setDailyMax(0)).to.emit(vault, 'ChangeDailyMax').withArgs(0, million);
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
      await expect( vault.connect(bob).setOpenLoanFee(12)).to.be.revertedWith("Caller is not an admin"); 
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


  describe("Role based access control", function () {
    const TIME_DELAY = 3 * 24 *60 *60 +1 //3 days
    const PAUSER = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("PAUSER_ROLE"));
    const ADMIN = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADMIN_ROLE"));
    beforeEach(async function (){
        const tx = await vault.connect(owner).proposeAddRole(bob.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(bob.address, PAUSER, owner.address, block.timestamp);

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
        const tx = await vault.connect(owner).proposeAddRole(alice.address, ADMIN);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(alice.address, ADMIN, owner.address, block.timestamp);
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(alice.address, ADMIN)).to.emit(vault, 'AddRole').withArgs(alice.address, ADMIN,  owner.address);
        await expect(vault.connect(alice).pause()).to.emit(vault, 'SystemPaused').withArgs(alice.address);
        expect( await vault.hasRole(PAUSER, alice.address) ).to.equal(false);
        expect( await vault.hasRole(ADMIN, alice.address) ).to.equal(true);
    });

    it("should add a role that works if following correct procedure", async function() {
      helpers.timeSkip(TIME_DELAY);
      await expect(vault.connect(owner).addRole(bob.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(bob.address, PAUSER,  owner.address);
      expect( await vault.hasRole(PAUSER, bob.address) ).to.equal(true);
      const tx = await vault.connect(bob).pause();
      const block = await ethers.provider.getBlock(tx.blockNumber);
      await expect(tx).to.emit(vault, 'SystemPaused').withArgs(bob.address);
    });

    it("should block non-role users calling role restricted functions", async function() {
      await expect(vault.connect(alice).pause()).to.be.revertedWith("Caller is not able to call pause");
    });

    it("should be possible to add, remove then add the same role user again", async function() {
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(bob.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(bob.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, bob.address) ).to.equal(true);
        await expect(vault.connect(owner).removeRole(bob.address, PAUSER)).to.emit(vault, 'RemoveRole').withArgs(bob.address,PAUSER, owner.address);
        expect( await vault.hasRole(PAUSER, bob.address) ).to.equal(false);
        const tx = await vault.connect(owner).proposeAddRole(bob.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(bob.address, PAUSER, owner.address, block.timestamp);
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(bob.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(bob.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, bob.address) ).to.equal(true);
    });

    it("should fail to remove a roleless account from a role", async function() {
      await expect(vault.connect(owner).removeRole(alice.address, PAUSER)).to.be.revertedWith("Address was not already specified role");
        

    });

    it("should fail to add a role if a non-admin tries to complete adding", async function() {
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(alice).addRole(bob.address, PAUSER)).to.be.revertedWith("Caller is not an admin");

    });

    it("should fail to add the role if proposed and add roles differ", async function() {
      helpers.timeSkip(TIME_DELAY);
      await expect(vault.connect(owner).addRole(bob.address, ADMIN)).to.be.revertedWith("Invalid Hash");

  });
    
    it("should fail to queue multiple role adds at the same time", async function() {
        const tx = await vault.connect(owner).proposeAddRole(alice.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(alice.address, PAUSER, owner.address, block.timestamp);
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(bob.address, PAUSER)).to.be.revertedWith("Invalid Hash");
        await expect(vault.connect(owner).addRole(alice.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(alice.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, bob.address) ).to.equal(false);
        expect( await vault.hasRole(PAUSER, alice.address) ).to.equal(true);

    });

    it("should succeed to add a role if nonce has been incremented (i.e. repeat transaction)", async function() {
        const tx = await vault.connect(owner).proposeAddRole(bob.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(bob.address, PAUSER, owner.address, block.timestamp);
        await expect(vault.connect(owner).addRole(bob.address, PAUSER)).to.be.revertedWith("Not enough time has passed");
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(bob.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(bob.address, PAUSER,  owner.address);

    });

    it("should succeed to add multiple role users sequentially with required time delays", async function() {
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(bob.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(bob.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, bob.address) ).to.equal(true);
        const tx = await vault.connect(owner).proposeAddRole(alice.address, PAUSER);
        const block = await ethers.provider.getBlock(tx.blockNumber);
        await expect(tx).to.emit(vault, 'QueueAddRole').withArgs(alice.address, PAUSER, owner.address, block.timestamp);
        expect( await vault.hasRole(PAUSER, alice.address) ).to.equal(false);
        helpers.timeSkip(TIME_DELAY);
        await expect(vault.connect(owner).addRole(alice.address, PAUSER)).to.emit(vault, 'AddRole').withArgs(alice.address, PAUSER,  owner.address);
        expect( await vault.hasRole(PAUSER, alice.address) ).to.equal(true);
    });

});

});
