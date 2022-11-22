pragma solidity 0.8.9;

interface IRewardsDistributor {
    function claim_many(uint[] memory _tokenIds) external returns (bool);
}