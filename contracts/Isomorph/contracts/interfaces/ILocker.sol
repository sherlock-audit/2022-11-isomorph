interface ILocker {
  function acceptOwnership (  ) external;
  function claimBribesMultiNFTs ( address[] calldata _bribes, address[][] calldata _tokens, uint256[] calldata _tokenIds ) external;
  function claimFeesMultiNFTs ( address[] calldata _fees, address[][] calldata _tokens, uint256[] calldata _tokenIds ) external;
  function claimRebaseMultiNFTs ( uint256[] calldata _tokenIds ) external;
  function lockVELO ( uint256 _tokenAmount, uint256 _lockDuration ) external;
  function owner (  ) external view returns ( address );
  function relockVELO ( uint256 _NFTId, uint256 _lockDuration ) external;
  function removeERC20Tokens ( address[] calldata _tokens, uint256[] calldata _amounts ) external;
  function rewardsDistributor (  ) external view returns ( address );
  function transferNFTs ( uint256[] calldata _tokenIds, uint256[] calldata _indexes ) external;
  function transferOwnership ( address to ) external;
  function veNFTIds ( uint256 ) external view returns ( uint256 );
  function velo (  ) external view returns ( address );
  function vote ( uint256[] calldata _NFTIds, address[] calldata _poolVote, uint256[] calldata _weights ) external;
  function voter (  ) external view returns ( address );
  function votingEscrow (  ) external view returns ( address );
  function withdrawNFT ( uint256 _tokenId, uint256 _index ) external;
}
