
//optimism mainnet addresses
const sUSD = `0x8c6f28f2F1A3C87F0f938b96d27520d9751ec8d9`
const USDC = "0x7F5c764cBc14f9669B88837ca1490cCa17c31607" 
const WETH = "0x4200000000000000000000000000000000000006"
const VELO = "0x3c8B650257cFb5f272f799F5e2b4e65093a11a05"
const SNX = "0x8700dAec35aF8Ff88c16BdF0418774CB3D7599B4"
const OP_Token = "0x4200000000000000000000000000000000000042"
const sAMM_USDC_sUSD = "0xd16232ad60188B68076a235c65d692090caba155"
const gauge = "0xb03f52D2DB3e758DD49982Defd6AeEFEa9454e80"
const voter = "0x09236cfF45047DBee6B921e00704bed6D6B8Cf7e"
const router = "0xa132DAB612dB5cB9fC9Ac426A0Cc215A3423F9c9"
const chainlink_SUSD_feed = "0x7f99817d87baD03ea21E05112Ca799d715730efe"
const chainlink_SNX_feed = "0x2FCF37343e916eAEd1f1DdaaF84458a359b53877"
const chainlink_ETH_feed = "0x13e3Ee699D1909E989722E753853AE30b17e08c5"
const chainlink_OP_feed = "0x0D276FC14719f9292D5C1eA2198673d1f4269246"
const SNX_doner = "0xa5f7a39E55D7878bC5bd754eE5d6BD7a7662355b"
const USDC_doner = "0xd6216fc19db775df9774a6e33526131da7d19a2c"

const sAMM_USDC_sUSD_donor = "0x0E4375cA948a0Cc301dd0425A4c5e163b03a65D0"



const optimism_OP = {sUSD: sUSD, 
                     USDC: USDC,
                     WETH: WETH,
                     VELO: VELO,
                     SNX: SNX,
                     OP: OP_Token,
                     AMMToken : sAMM_USDC_sUSD,
                     Gauge : gauge,
                     Voter : voter,
                     Router : router,
                     AMMToken_Donor : sAMM_USDC_sUSD_donor,
                     SNX_Doner : SNX_doner,
                     USDC_Doner : USDC_doner,
                     Chainlink_SUSD_Feed : chainlink_SUSD_feed,
                     Chainlink_ETH_Feed : chainlink_ETH_feed,
                     Chainlink_SNX_Feed : chainlink_SNX_feed,
                     Chainlink_OP_Feed : chainlink_OP_feed}


addresses = {optimism: optimism_OP}

module.exports = { addresses }


      
      
      
