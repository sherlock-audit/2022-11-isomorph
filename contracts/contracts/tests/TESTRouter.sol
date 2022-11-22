pragma solidity =0.8.9;



contract TESTRouter {
    address USDC = 0x7F5c764cBc14f9669B88837ca1490cCa17c31607;

    function addLiquidity() external{
        //dumbie to get a vAMM or sAMM test token
    }

    function quoteRemoveLiquidity(address tokenA, address tokenB, bool stable, uint256 liquidity) external view returns(uint256 amountA, uint256 amountB){
        //return different values to make unit test error detection easier
        if(tokenA == USDC){
            return(liquidity/1e12, (liquidity *11) /10); 
        }
        else{
            return((liquidity *11) /10, liquidity/1e12); 
        }
    }

    function getAmountOut(uint256 amountIn, address tokenIn, address tokenOut) external view returns(uint256 amount, bool stable){
        //return different values to make unit test error detection easier
        if(tokenIn == USDC){
            return((amountIn *3) /2, true); //return 1.5x amountIn
        }
        else{
            return((amountIn *3)/5, true); //return 0.6x amountIn
        }
    } 
}