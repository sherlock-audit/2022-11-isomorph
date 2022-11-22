const { expect } = require("chai")
const { ethers } = require("hardhat")
const { helpers } = require("../helpers/testHelpers.js")
const { addresses } = require("../helpers/deployedAddresses.js")
const { ABIs } = require("../helpers/abi.js")

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

describe("Integration OP Mainnet: DepositReceipt ETH contract", function () {
    const provider = ethers.provider;
    const ADMIN_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("ADMIN_ROLE"));
    const MINTER_ROLE = ethers.utils.keccak256(ethers.utils.toUtf8Bytes("MINTER_ROLE"));

    const router_address = addresses.optimism.Router
    const USDC_address = addresses.optimism.USDC
    const WETH_address = addresses.optimism.WETH
    const sUSD_address = addresses.optimism.sUSD
    const OP_address = addresses.optimism.OP
    const USDC_doner = addresses.optimism.USDC_Doner
    const price_feed_OP_address = addresses.optimism.Chainlink_OP_Feed
    const price_feed_SNX_address = addresses.optimism.Chainlink_SNX_Feed
    const price_feed_ETH_address = addresses.optimism.Chainlink_ETH_Feed

    router = new ethers.Contract(router_address, ABIs.Router, provider)
    price_feed_OP = new ethers.Contract(price_feed_OP_address, ABIs.PriceFeed, provider)
    price_feed_ETH = new ethers.Contract(price_feed_ETH_address, ABIs.PriceFeed, provider)
    OP =  new ethers.Contract(OP_address, ABIs.ERC20, provider)
    USDC =  new ethers.Contract(USDC_address, ABIs.ERC20, provider)
    sUSD =  new ethers.Contract(sUSD_address, ABIs.ERC20, provider)
    WETH =  new ethers.Contract(WETH_address, ABIs.ERC20, provider)

    before(async function () {
        
        [owner, alice, bob, ...addrs] = await ethers.getSigners()
        DepositReceipt = await ethers.getContractFactory("DepositReceipt_ETH")
        TESTERC20Token8DP = await ethers.getContractFactory("TESTERC20Token8DP")
        erc20_8DP = await TESTERC20Token8DP.deploy("8DPToken", "8DP")
        TESTERC20Token = await ethers.getContractFactory("TESTERC20Token")
        tokenA = await TESTERC20Token8DP.deploy("TokenA", "TA")
        

        depositReceipt = await DepositReceipt.deploy(
            "Deposit_Receipt",
            "DR",
            router.address,
            WETH.address,
            OP.address,
            false,
            price_feed_ETH.address,
            price_feed_OP.address
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
                router.address,
                tokenA.address,
                sUSD.address,
                false,
                price_feed_ETH.address,
                price_feed_OP.address
                )).to.be.revertedWith("One token must be WETH")

            await expect(DepositReceipt.deploy(
                "Deposit_Receipt",
                "DR",
                router.address,
                sUSD.address,
                tokenA.address,
                false,
                price_feed_ETH.address,
                price_feed_OP.address
                )).to.be.revertedWith("One token must be WETH")
        });
        
        it("should enforce the non-WETH token having 18d.p", async function (){
            //success case is handed by general set up
            
            await expect(DepositReceipt.deploy(
                "Deposit_Receipt",
                "DR",
                router.address,
                WETH.address,
                erc20_8DP.address,
                false,
                price_feed_ETH.address,
                price_feed_OP.address
                )).to.be.revertedWith("Token does not have 18dp")

            await expect(DepositReceipt.deploy(
                "Deposit_Receipt",
                "DR",
                router.address,
                erc20_8DP.address,
                WETH.address,
                false,
                price_feed_ETH.address,
                price_feed_OP.address
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

    describe("Minting", function (){
        it("Should allow only ADMIN_ROLE address to add MINTER_ROLE and emit event", async function (){
            await expect(depositReceipt.connect(owner).addMinter(bob.address)).to.emit(depositReceipt, "AddNewMinter").withArgs(bob.address, owner.address)
            await expect(depositReceipt.connect(bob).addMinter(alice.address)).to.revertedWith("Caller is not an admin")
        });

        it("Should only allow MINTER_ROLE address to mint/burn", async function (){
            await depositReceipt.connect(owner).addMinter(bob.address)
            const amount = ethers.utils.parseEther('353')
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
            const amount = ethers.utils.parseEther('353')
            const BASE = ethers.utils.parseEther('1')
            await depositReceipt.connect(bob).safeMint(amount)
            let nft_id = 1
            let new_nft_id = nft_id +1
            let split = ethers.utils.parseEther('0.53') //53%
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
            expect( await depositReceipt.relatedDepositor(nft_id)).to.equal(original_depositor)

        });

        it("Should reject split percentages not in [0,100)", async function (){
            await depositReceipt.connect(owner).addMinter(bob.address)
            const amount = ethers.utils.parseEther('353')
            const BASE = ethers.utils.parseEther('1')
            await depositReceipt.connect(bob).safeMint(amount)
            let nft_id = 1
            let new_nft_id = nft_id +1
            let bad_split = ethers.utils.parseEther('1') //100%
            let bad_split_2 = ethers.utils.parseEther('2') //200%
        
            //call split here, check correct functioning
            await expect(depositReceipt.connect(owner).split(nft_id, bad_split)).to.be.revertedWith('split must be less than 100%')

            await expect(depositReceipt.connect(owner).split(nft_id, bad_split_2)).to.be.revertedWith('split must be less than 100%')

        });
      });

      describe("Pricing Pooled Tokens", function (){
        

        it("Should quote removable liquidity correctly", async function (){
            //pass through function so this only checks inputs haven't been mismatched
            const liquidity = ethers.utils.parseEther('1') 
            
            let output = await depositReceipt.viewQuoteRemoveLiquidity(liquidity)
            //error here
            let expected_output = await router.quoteRemoveLiquidity(WETH.address, OP.address, false, liquidity)
    
            expect(output[0]).to.equal(expected_output[0])
            expect(output[1]).to.equal(expected_output[1])
            

        });

        it("Should revert price checks if a large swap tries to manipulate the value", async function (){


            //pass through function so this only checks inputs haven't been mismatched
            const liquidity = ethers.utils.parseEther('1') 
            
            //let tokens_before_swap = await depositReceipt.viewQuoteRemoveLiquidity(liquidity)
            let base = ethers.utils.parseEther('1');
            let USDC_base = 1000000
            //USDC Swap amount
            let USDC_amount = ethers.utils.parseEther('0.000001') //USDC is 6d.p. so this is $1 million

            //borrow USDC tokens from doner addresses 
            impersonateForToken(provider, owner, USDC, USDC_doner, USDC_amount.mul(2).add(USDC_base))
            
            let amountOutMin = 10 //we want a large trade where we do not care about slippage so we set this very low
            let deadline = 1981351922 //year 2032
            await USDC.connect(owner).approve(router.address, USDC_amount)
            //Use borrowed USDC to get large OP balance
            await router.connect(owner).swapExactTokensForTokensSimple(USDC_amount, amountOutMin, USDC.address, OP.address, false, owner.address, deadline)
    
            let tokens_before_swap = await router.quoteRemoveLiquidity(WETH.address, OP.address, false, liquidity)
            //console.log("Before swap share is usdc ", tokens_before_swap[0], " snx ", tokens_before_swap[1])
            
            //expect price checks prior to the swap to succeed
            await depositReceipt.priceLiquidity(liquidity)

            let balance_before = await WETH.balanceOf(owner.address)
            const swap_amount = ethers.utils.parseEther('100000') 
            await OP.connect(owner).approve(router.address, swap_amount)

            await router.connect(owner).swapExactTokensForTokensSimple(swap_amount, amountOutMin, OP.address, WETH.address, false, owner.address, deadline)
        
            let balance_after = await WETH.balanceOf(owner.address)

            let tokens_after_swap = await router.quoteRemoveLiquidity(WETH.address, OP.address, false, liquidity)
            //console.log("After swap share is usdc ", tokens_after_swap[0], " snx ", tokens_after_swap[1])
            //expect price checks after to the swap to fail
            await expect (depositReceipt.priceLiquidity(liquidity)).to.be.revertedWith("Price shift low detected")
            
            //swap original trade amount back to get exchange rate roughly back to normal
            let ETH_to_swap = balance_after.sub(balance_before)
            await WETH.connect(owner).approve(router.address, balance_after)
            await router.connect(owner).swapExactTokensForTokensSimple(ETH_to_swap, amountOutMin, WETH.address, OP.address, false, owner.address, deadline)
            
            //expect price checks after resetting exchange rate on Velodrome to pass
            await depositReceipt.priceLiquidity(liquidity)

        });


        it("Should price liquidity right depending on which token WETH is", async function (){
            const liquidity = ethers.utils.parseEther('1')
            const ORACLE_BASE = 10 ** 8
            let value = await depositReceipt.priceLiquidity(liquidity)
            
            
            let outputs = await depositReceipt.viewQuoteRemoveLiquidity(liquidity)
            // token0 is WETH 
            let latest_round_ETH = await (price_feed_ETH.latestRoundData())
            let ETH_price = latest_round_ETH[1]
            let value_token0 = outputs[0].mul(ETH_price)
            let latest_round = await (price_feed_OP.latestRoundData())
            let price = latest_round[1]
            let value_token1 = outputs[1].mul(price)
            let expected_value = ( value_token0.add( value_token1 )).div(ORACLE_BASE)
            expect(value).to.equal(expected_value)


            
            //in the second instance USDC is token1
            // As we are on a network fork the oracles do not update so we can reuse their prices
            depositReceipt2 = await DepositReceipt.deploy(
                "Deposit_Receipt2",
                "DR2",
                router.address,
                OP.address,
                WETH.address,
                false,
                price_feed_ETH.address,
                price_feed_OP.address
                )

            value = await depositReceipt2.priceLiquidity(liquidity)
            
            outputs = await depositReceipt.viewQuoteRemoveLiquidity(liquidity)
            //as token0 is not WETH we have assumed token1 is
            value_token0 = outputs[1].mul(price)
            
            //as token1 is WETH
            value_token1 = outputs[0].mul(ETH_price)
            expected_value = ( value_token0.add( value_token1 )).div(ORACLE_BASE)
            expect(value).to.equal(expected_value)
                
            
        });
      });
})
