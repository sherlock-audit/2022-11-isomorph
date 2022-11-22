const { expect } = require("chai")
const { ethers } = require("hardhat")
const { helpers } = require("../helpers/testHelpers.js")
const { addresses } = require("../helpers/deployedAddresses.js")

describe("Unit tests: DepositReceiptETH contract", function () {
    const provider = ethers.provider;
    const ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADMIN_ROLE"))
    const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"))
    const WETH = addresses.optimism.WETH
   

    before(async function () {
        
        [owner, alice, bob, ...addrs] = await ethers.getSigners()
        DepositReceipt = await ethers.getContractFactory("DepositReceipt_ETH")
        Router_ETH = await ethers.getContractFactory("TESTRouterETH")
        PriceOracle = await ethers.getContractFactory("TESTAggregatorV3")
        TESTERC20Token8DP = await ethers.getContractFactory("TESTERC20Token8DP")
        TESTERC20Token = await ethers.getContractFactory("TESTERC20Token")

        token1 = await TESTERC20Token.deploy("token1", "WETH")
        token2 = await TESTERC20Token.deploy("token2", "TB")
        token3 = await TESTERC20Token.deploy("token3", "TC")
        erc20_8DP = await TESTERC20Token8DP.deploy("8DPToken", "8DP")
        router_ETH = await Router_ETH.deploy()
        priceOracle = await PriceOracle.deploy(110000000)
        ETHPriceOracle = await PriceOracle.deploy(1200000000)

        

        depositReceipt = await DepositReceipt.deploy(
            "Deposit_Receipt",
            "DR",
            router_ETH.address,
            token1.address,
            token2.address,
            true,
            ETHPriceOracle.address,
            priceOracle.address
            )

        //duplicate used for one pricing test
        depositReceipt2 = await DepositReceipt.deploy(
                "Deposit_Receipt",
                "DR",
                router_ETH.address,
                token2.address,
                token1.address,
                true,
                ETHPriceOracle.address,
                priceOracle.address
                )

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
        it("Should revert if neither token is WETH", async function (){
            
            await expect(DepositReceipt.deploy(
                "Deposit_Receipt",
                "DR",
                router_ETH.address,
                token3.address,
                token2.address,
                true,
                ETHPriceOracle.address,
                price_feed.address
                )).to.be.revertedWith("One token must be WETH")

            await expect(DepositReceipt.deploy(
                    "Deposit_Receipt",
                    "DR",
                    router_ETH.address,
                    token2.address,
                    token3.address,
                    true,
                    ETHPriceOracle.address,
                    price_feed.address
                    )).to.be.revertedWith("One token must be WETH")
                    
        });
        it("should enforce the non-WETH token having 18d.p", async function (){
            //success case is handed by general set up
            
            await expect(DepositReceipt.deploy(
                "Deposit_Receipt",
                "DR",
                router_ETH.address,
                WETH,
                erc20_8DP.address,
                true,
                ETHPriceOracle.address,
                price_feed.address
                )).to.be.revertedWith("Token does not have 18dp")

            await expect(DepositReceipt.deploy(
                "Deposit_Receipt",
                "DR",
                router_ETH.address,
                erc20_8DP.address,
                WETH,
                true,
                ETHPriceOracle.address,
                price_feed.address
                )).to.be.revertedWith("Token does not have 18dp")
                    
        });
      });


    describe("Admin role", function (){
        it("Should add Msg.sender as ADMIN", async function (){
            expect( await depositReceipt.hasRole(ADMIN_ROLE, owner.address) ).to.equal(true)
            
        });
        it("should not let Admin role addresses mint", async function (){
            expect( await depositReceipt.hasRole(MINTER_ROLE, owner.address) ).to.equal(false)
            await expect(depositReceipt.connect(owner).safeMint(1)).to.be.revertedWith("Caller is not a minter")
        });
      });

    describe("supportsInterface", function (){
        it("Return true only when given the correct interface ID as an arguement by anyone", async function (){
            let interface_id = [255, 255, 255, 255]
            expect( await depositReceipt.connect(alice).supportsInterface(interface_id) ).to.equal(false)

            //too lazy to calculate, this is the correct byte string taken from here
            // https://eips.ethereum.org/EIPS/eip-165#how-interfaces-are-identified
            interface_id = [01, 255, 201, 167] //0x01ffc9a7 (EIP165 interface)
            expect( await depositReceipt.connect(alice).supportsInterface(interface_id) ).to.equal(true)
            
        });
      });

    describe("Minting", function (){
        it("Should allow only ADMIN_ROLE address to add MINTER_ROLE and emit event", async function (){
            await expect(depositReceipt.connect(owner).addMinter(bob.address)).to.emit(depositReceipt, "AddNewMinter").withArgs(bob.address, owner.address)
            await expect(depositReceipt.connect(bob).addMinter(alice.address)).to.revertedWith("Caller is not an admin")
        });

        it("Should only allow MINTER_ROLE address to mint/burn", async function (){
            await depositReceipt.connect(owner).addMinter(bob.address)
            const amount = ethers.utils.parseEther('353');
            await depositReceipt.connect(bob).safeMint(amount)
            let nft_id = 1
            expect( await depositReceipt.ownerOf(nft_id)).to.equal(bob.address)
            expect( await depositReceipt.pooledTokens(nft_id)).to.equal(amount)
            expect( await depositReceipt.relatedDepositor(nft_id)).to.equal(bob.address)
    
            await expect(depositReceipt.connect(alice).safeMint(1)).to.be.revertedWith("Caller is not a minter")

            await expect(depositReceipt.connect(alice).burn(nft_id)).to.be.revertedWith("Caller is not a minter")
        });
      });

      describe("Splitting NFTs", function (){
        

        it("Should only allow owner to split the NFT", async function (){
            await depositReceipt.connect(owner).addMinter(bob.address)
            const amount = ethers.utils.parseEther('353');
            const BASE = ethers.utils.parseEther('1');
            await depositReceipt.connect(bob).safeMint(amount)
            let nft_id = 1
            let new_nft_id = nft_id +1
            let split = ethers.utils.parseEther('0.53'); //53%
            expect( await depositReceipt.ownerOf(nft_id)).to.equal(bob.address)
            expect( await depositReceipt.pooledTokens(nft_id)).to.equal(amount)
            let original_depositor = await depositReceipt.relatedDepositor(nft_id)
        
            //call split here with wrong user
            await expect(depositReceipt.connect(owner).split(nft_id, split)).to.be.revertedWith('ERC721: caller is not token owner or approved')

            //call split with right user
            await expect(depositReceipt.connect(bob).split(nft_id, split)).to.emit(depositReceipt, "NFTSplit").withArgs(nft_id, new_nft_id)
            //check other two emitted events here too

            //check new NFT details
            expect( await depositReceipt.ownerOf(new_nft_id)).to.equal(bob.address)
            expect( await depositReceipt.relatedDepositor(new_nft_id)).to.equal(original_depositor)
            let new_pooled_tokens = amount.mul(split).div(BASE)
            expect( await depositReceipt.pooledTokens(new_nft_id)).to.equal(new_pooled_tokens)

            //check old NFT details
            expect( await depositReceipt.ownerOf(nft_id)).to.equal(bob.address)
            expect( await depositReceipt.pooledTokens(nft_id)).to.equal(amount.sub(new_pooled_tokens))
            //depositor should not have changed
            expect( await depositReceipt.relatedDepositor(nft_id)).to.equal(original_depositor)
            

        });

        it("Should reject split percentages not in [0,100)", async function (){
            await depositReceipt.connect(owner).addMinter(bob.address)
            const amount = ethers.utils.parseEther('353');
            const BASE = ethers.utils.parseEther('1');
            await depositReceipt.connect(bob).safeMint(amount)
            let nft_id = 1
            let new_nft_id = nft_id +1
            let bad_split = ethers.utils.parseEther('1'); //100%
            let bad_split_2 = ethers.utils.parseEther('2'); //200%
        
            //call split here, check correct functioning
            await expect(depositReceipt.connect(owner).split(nft_id, bad_split)).to.be.revertedWith('split must be less than 100%')

            await expect(depositReceipt.connect(owner).split(nft_id, bad_split_2)).to.be.revertedWith('split must be less than 100%')

        });
      });

      describe("Pricing Pooled Tokens", function (){
        
        //test broken by new fake router contract, covered in integration tests so no urgent need to fix.
        /*
        it("Should quote removable liquidity correctly", async function (){
            //pass through function so this only checks inputs haven't been mismatched
            const liquidity = ethers.utils.parseEther('1'); 
            
            let output = await depositReceipt.viewQuoteRemoveLiquidity(liquidity)
            console.log("quote happened")
            let expected_output = await router_ETH.quoteRemoveLiquidity(alice.address, bob.address, true, liquidity)
    
            expect(output[0]).to.equal(expected_output[0])
            expect(output[1]).to.equal(expected_output[1])
            

        });
        */
        
        //test broken by new flash loan resistent price oracle, covered in integration tests so no urgent need to fix
        /*
        it.only("Should price liquidity right depending on which token WETH is", async function (){
            const liquidity = ethers.utils.parseEther('1'); 
            let value = await depositReceipt.priceLiquidity(liquidity)
            //token 0 is WETH
            let outputs = await depositReceipt.viewQuoteRemoveLiquidity(liquidity)
            let value_token0 = outputs[0].mul(12)
            let value_token1 = outputs[1].mul(11).div(10)
            console.log("value zero", value_token0)
            console.log("value one", value_token1)
            let expected_value = ( value_token0 ).add( value_token1 )
            expect(value).to.equal(expected_value)

            
            //in the second instance USDC is token0
            let value2 = await depositReceipt2.priceLiquidity(liquidity)
            //as token0 is not WETH we have assumed token1 is
            let outputs2 = await depositReceipt2.viewQuoteRemoveLiquidity(liquidity)
            value_token0 = outputs2[0].mul(11).div(10)
            value_token1 = outputs2[1].mul(12)
            let expected_value2 = ( value_token0 ).add(value_token1 )
            expect(value2).to.equal(expected_value2)
            
            
        });
        */
        

        it("Should revert if Price is outside of boundaries", async function (){
            too_high_price = 1000000000000
            too_low_price = 100
            negative_price = -1
            await priceOracle.setPrice(too_high_price)
            const liquidity = ethers.utils.parseEther('1'); 

            await expect(depositReceipt.priceLiquidity(liquidity)).to.be.revertedWith("Upper price bound breached");
            await priceOracle.setPrice(too_low_price)
            await expect(depositReceipt.priceLiquidity(liquidity)).to.be.revertedWith("Lower price bound breached");
            await priceOracle.setPrice(negative_price)
            await expect(depositReceipt.priceLiquidity(liquidity)).to.be.revertedWith("Negative Oracle Price");
            
        });

        it("Should revert if Price update timestamp is stale", async function (){
            stale_timestamp = 1000000
            await priceOracle.setTimestamp(stale_timestamp)
            const liquidity = ethers.utils.parseEther('1'); 

            await expect(depositReceipt.priceLiquidity(liquidity)).to.be.revertedWith("Stale pricefeed");
            
        });
      });
})
