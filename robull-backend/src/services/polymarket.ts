import { MarketCategory, PolymarketMarket } from '../types/index.js';
import { computeB, bootstrapQuantities } from './lmsr.js';

const GAMMA_API = 'https://gamma-api.polymarket.com';
const MIN_VOLUME = Number(process.env.MARKET_MIN_VOLUME ?? 500_000);
const MIN_VOLUME_CRYPTO_MACRO = Number(process.env.MARKET_MIN_VOLUME_CRYPTO_MACRO ?? 50_000);

interface GammaEvent {
  id: string;
  slug: string;
}

interface GammaMarket {
  id: string;
  question: string;
  slug: string;
  outcomePrices: string; // JSON array of price strings e.g. '["0.65","0.35"]'
  outcomes: string;      // JSON array e.g. '["Yes","No"]'
  volume: string;
  endDate: string;
  active: boolean;
  closed: boolean;
  new: boolean;
  tags?: { label: string }[];
  conditionId?: string;
  events?: GammaEvent[];
}

export interface NormalisedMarket {
  polymarket_id: string;
  question: string;
  category: MarketCategory;
  slug: string;
  polymarket_url: string;
  volume: number;
  b_parameter: number;
  outcomes: string[];
  quantities: number[];
  initial_probs: number[];
  closes_at: string | null;
}

// ─── Helper: build a case-insensitive regex from an array of patterns ──────────
function re(patterns: RegExp[]): RegExp {
  return new RegExp(patterns.map(r => r.source).join('|'), 'i');
}

// ─── SPORTS ────────────────────────────────────────────────────────────────────
// Checked FIRST — catches team names, "vs.", "win on <date>" before other rules
// can misfire on substrings like "eth" in "Beth".
const SPORTS_RE = re([
  // Leagues & tournaments
  /\bnba\b/, /\bnfl\b/, /\bnhl\b/, /\bmlb\b/, /\bmls\b/, /\bfifa\b/, /\bepl\b/, /\bucl\b/,
  /\bwbc\b/, /\bafl\b/, /\bwnba\b/, /\blpga\b/, /\batp\b/, /\bwta\b/, /\bipl\b/,
  /world cup/, /champions league/, /premier league/, /la liga/, /bundesliga/, /serie a/,
  /ligue 1/, /super bowl/, /playoff/, /\bchampionship\b/, /\btournament\b/,
  /grand slam/, /wimbledon/, /us open/, /french open/, /australian open/,
  /formula 1/, /\bf1 drivers\b/, /\bgolf\b/, /\bpga\b/, /\bmasters tournament\b/,
  /nascar/, /\bindycar\b/, /\bmoto\s?gp\b/,
  /\bmma\b/, /\bufc\b/, /\bboxing\b/, /\bolympic/, /\bcricket\b/, /\brugby\b/, /\btennis\b/,
  /carabao cup/, /\bfa cup\b/, /\befl\b/, /league cup/, /copa america/, /copa libertadores/,
  /europa league/, /conference league/, /nations league/,
  /promotion/, /relegation/, /\btransfer\b/, /manager sacked/,
  /match winner/, /season winner/, /top scorer/, /\bmvp\b/, /\bdraft pick\b/,
  /golden boot/, /ballon d'or/, /heisman/,
  // Match-style patterns: "Team vs. Team", "Will <Team> win on <date>", O/U lines, spreads
  /\bvs\.?\s/, /\bwin on \d{4}/, /\bo\/u\s?\d/, /\bspread\b/, /\bmoneyline\b/,
  /\bover\s?\d+\.?\d*\s*(?:goals|points|runs|sets)/, /\bunder\s?\d+\.?\d*\s*(?:goals|points|runs|sets)/,
  /\b\(bo\d\)\b/,  // BO3, BO5 — esports / tennis
  // Club suffixes — very strong sports signal
  /\bfc\b/, /\bcf\b/, /\bafc\b/, /\bsc\b.*(?:win|match|season)/,
  /\bunited\b.*(?:win|match|vs)/, /\bcity\b.*(?:win|match|vs|fc)/,
  /\brovers?\b.*(?:win|match|vs)/, /\brangers?\b.*(?:win|match|vs)/,
  // NBA teams
  /nuggets/, /lakers/, /celtics/, /clippers/, /76ers/, /wizards/,
  /\bnets\b.*(?:vs|win)/, /cavaliers/, /warriors/, /rockets/, /spurs\b.*(?:vs|win|nba)/,
  /bucks\b.*(?:vs|win|nba)/, /raptors/, /grizzlies/, /pelicans/, /timberwolves/,
  /thunder\b.*(?:vs|win|nba)/, /mavericks/, /pacers/, /hornets/, /pistons/, /hawks\b.*(?:vs|win|nba)/,
  /heat\b.*(?:vs|win|nba)/, /magic\b.*(?:vs|win|nba)/, /knicks/, /suns\b.*(?:vs|win|nba)/,
  /blazers/, /jazz\b.*(?:vs|win|nba)/,
  // NHL teams
  /\bdevils\b/, /\bsharks\b/, /\bflyers\b/, /\bbruins\b/, /\bcapitals\b/,
  /\bcanadiens\b/, /\bblue jackets\b/, /\bpenguins\b/, /\bred wings\b/,
  /\bblackhawks\b/, /\bpanthers\b.*(?:vs|win|nhl)/, /\blightning\b/,
  /\bmaple leafs\b/, /\bcanucks\b/, /\boilers\b/, /\bflames\b/, /\bstars\b.*(?:vs|win|nhl)/,
  /\bkraken\b.*(?:vs|win|nhl)/, /\bhurricanes\b.*(?:vs|win|nhl)/,
  /\bavalanche\b.*(?:vs|win|nhl)/, /\bpredators\b/, /\bsabres\b/, /\bsenators\b.*(?:vs|win|nhl)/,
  /\bislanders\b/, /\bwild\b.*(?:vs|win|nhl)/,
  // MLB teams
  /padres/, /diamondbacks/, /\byankees\b/, /\bred sox\b/, /\bdodgers\b/, /\bmets\b.*(?:vs|win|mlb)/,
  /\bcubs\b/, /\bastros\b/, /\bbraves\b.*(?:vs|win|mlb)/, /\bphillies\b/, /\borioles\b/,
  /\bguardians\b/, /\broyals\b/, /\btwins\b.*(?:vs|win|mlb)/, /\bgiants\b.*(?:vs|win|mlb|sf)/,
  /\btigers\b.*(?:vs|win|mlb)/, /\bnationals\b.*(?:vs|win|mlb)/,
  /\bwhite sox\b/, /\bblue jays\b/, /\bcardinals\b.*(?:vs|win|mlb)/, /\bmariners\b/, /\bpirates\b.*(?:vs|win)/,
  /\brays\b.*(?:vs|win|mlb)/, /\bangels\b.*(?:vs|win|mlb)/, /\brewers\b/, /\breds\b.*(?:vs|win|mlb)/,
  /\brockies\b/, /\bathletics\b/,
  // NFL teams
  /\bchiefs\b/, /\beagles\b.*(?:vs|win|nfl)/, /\bpackers\b/, /\bcowboys\b/,
  /\b49ers\b/, /\bbills\b.*(?:vs|win|nfl)/, /\bravens\b/, /\blions\b.*(?:vs|win|nfl)/,
  /\bdolphins\b/, /\bchargers\b/, /\bsteelers\b/, /\bbears\b.*(?:vs|win|nfl)/,
  /\btexans\b.*(?:vs|win|nfl)/, /\bbengals\b/, /\bcommanders\b/, /\bjaguars\b/,
  /\bcolts\b/, /\bvikings\b/, /\bsaints\b.*(?:vs|win|nfl)/, /\bfalcons\b/,
  /\bbroncos\b/, /\bseahawks\b/, /\bcardinals\b.*(?:vs|win|nfl)/,
  /\braiders\b/, /\btitans\b.*(?:vs|win|nfl)/, /\bpatriots\b/,
  // European football clubs
  /arsenal/, /real madrid/, /manchester/, /liverpool/, /chelsea/, /tottenham/,
  /barcelona/, /juventus/, /bayern/, /inter miami/, /philadelphia union/,
  /sunderland/, /hoffenheim/, /hamburger sv/, /sevilla/, /lyon(?:nais)?/,
  /hellas verona/, /mallorca/, /valencia/, /sporting\b.*(?:win|champion)/,
  /midtjylland/, /henan/, /getafe/, /genoa/, /crystal palace/, /leeds united/,
  /atletico|atlético/, /napoli/, /lazio/, /roma\b.*(?:vs|win|serie)/, /fiorentina/,
  /dortmund/, /leverkusen/, /wolfsburg/, /gladbach/, /freiburg/,
  /marseille/, /monaco\b.*(?:vs|win|ligue)/, /lille/, /rennes/, /strasbourg/,
  /psv/, /ajax/, /feyenoord/, /benfica/, /porto\b.*(?:vs|win|champion)/,
  /galatasaray/, /fenerbahce|fenerbahçe/, /besiktas|beşiktaş/,
  /celtic\b.*(?:vs|win|champion|league)/, /rangers\b.*(?:vs|win|champion|league)/,
  /everton/, /west ham/, /wolves\b.*(?:vs|win|premier)/, /nottingham/,
  /bournemouth/, /fulham/, /brentford/, /brighton/, /aston villa/, /leicester/,
  /southampton/, /ipswich/, /newcastle/,
  // Tennis / golf / F1 player names
  /alcaraz/, /medvedev/, /djokovic/, /sinner/, /\bnadal\b/, /\bfederer\b/,
  /swiatek|świątek/, /\bgauff\b/, /sabalenka/, /schauffele/, /\brory\b.*(?:mcilroy|golf|masters)/,
  /verstappen/, /\bnorris\b.*(?:f1|driver|mclaren)/, /\bhamilton\b.*(?:f1|driver|mercedes)/,
  /colapinto/, /\bleclerc\b/, /\bpiastri\b/, /\brussell\b.*(?:f1|driver|mercedes)/,
  /bnp paribas open/, /indian wells/, /monte carlo masters/, /miami open/,
  // Esports
  /counter-strike/, /\bcsgo\b/, /\bcs2\b/, /\bdota\s?2\b/, /\bvalorant\b/,
  /\bleague of legends\b/, /\blol\b.*(?:world|champion|esport)/, /\besport/,
  /natus vincere/, /\bnavi\b.*(?:vs|esport)/, /\bastralis\b/, /\bfut esports\b/,
  /aurora gaming/, /team liquid/, /\bfnatic\b/, /\bg2\b.*(?:vs|esport)/,
  /\bfaze\b.*(?:vs|esport|clan)/, /\bc9\b.*(?:vs|esport)/, /\bcloud9\b/,
  /betboom/, /\beg\b.*(?:vs|esport|dota)/, /\bog\b.*(?:vs|esport|dota)/,
  /\besl\b.*(?:pro|league)/, /\bpgl\b.*(?:major|tournament)/,
  /\b\(bo3\)/, /\b\(bo5\)/,
  // WBC / international baseball
  /\bfinal stage\b.*(?:japan|venezuela|usa|korea|cuba|dominican)/,
]);

// ─── POLITICS ──────────────────────────────────────────────────────────────────
const POLITICS_RE = re([
  // Institutions & processes
  /\belection\b/, /\bpresident/, /prime minister/, /\bsenator?\b/, /\bcongress/,
  /parliament/, /\bvote\b/, /\bballot\b/, /\bdemocrat/, /\brepublican/,
  /political party/, /\bgovernment\b/, /\bminister\b/, /\bchancellor\b/,
  /\bmayor\b/, /\bgovernor\b/, /\bnato\b/, /\bsanctions\b/,
  /\bceasefire\b/, /\btreaty\b/, /\bdiplomat/, /\bregime\b/, /\bcoup\b/,
  /\bwar\b/, /\bconflict\b/, /\bgeopolit/, /\bmilitary\b.*(?:strike|action|force|operation)/,
  /white house/, /\bcabinet\b/, /legislation/, /impeach/, /\bveto\b/,
  /\bscotus\b/, /supreme court/,
  /\bdhs\b/, /\bcia\b/, /\bfbi\b/, /\bnsa\b/,
  /\binvasion\b/, /\bannex/, /\boccup(?:y|ation)\b/, /\bembargo\b/,
  /\brefugee\b/, /\basylum\b/, /\bdeport/, /\bimmigration\b/,
  /\bprimary\b.*(?:win|election|republican|democrat)/,
  /leadership change/, /\bleader of\b/,
  // Countries / regions (geopolitical context)
  /\bukraine\b/, /\brussia\b/, /\bchina\b/, /\btaiwan\b/, /\biran\b/,
  /\bisrael\b/, /\bgaza\b/, /\bhamas\b/, /\bcuba\b/, /\bgreenland\b/,
  /\bnorth korea\b/, /\bsyria\b/, /\byemen\b/, /\bvenezuela\b/,
  /\bhouthis?\b/, /\bhezbollah\b/, /\btaliban\b/,
  /strait of hormuz/,
  // Politician names — extensive list
  /\btrump\b/, /\bbiden\b/, /\bharris\b/, /\bobama\b/, /\bclinton\b/,
  /\bputin\b/, /\bzelensky\b/, /\bxi jinping\b/, /\bmodi\b/, /\bmacron\b/,
  /\bstarmer\b/, /\bsunak\b/, /\bbadenoch\b/, /\bmerkel\b/, /\bscholz\b/,
  /\bmeloni\b/, /\berdogan\b/, /\bkhamenei\b/, /\bnetanyahu\b/, /\babbas\b/,
  /\bmilei\b/, /\blula\b/, /\bbolsonaro\b/, /\btrudeau\b/,
  /\balbanese\b/, /\bardern\b/, /\bfarage\b/, /\ble pen\b/, /\borban\b/,
  /\bkim jong un\b/, /\bmaduro\b/, /\bcastro\b/, /\blukashenko\b/,
  /\bmbs\b/, /\bbin salman\b/, /\bsisi\b/, /\bkagame\b/, /\bramaphosa\b/,
  /\bhegseth\b/, /\bmachado\b/, /\bguaidó?\b/,
  /\bpetro\b/, /\bkapitány\b/, /\brodríguez\b.*(?:leader|venezuela)/,
  /van duyne/, /balance of power/,
  /\bus forces\b/, /\bus strike\b/, /\bacquire\b.*\bgreenland\b/,
]);

// ─── CRYPTO ────────────────────────────────────────────────────────────────────
const CRYPTO_RE = re([
  /\bbitcoin\b/, /\bbtc\b/, /\bethereum\b/, /\bcrypto\b/, /\bblockchain\b/,
  /\bdefi\b/, /\bnft\b/, /\bstablecoin\b/, /\busdc\b/, /\busdt\b/, /\btether\b/,
  /\bcoinbase\b/, /\bbinance\b/,
  /\baltcoin\b/, /\bmemecoin\b/, /\bairdrop\b/, /\bwallet\b/, /\bweb3\b/,
  /\bon-chain\b/, /\bprotocol\b.*(?:token|tvl|launch|defi)/,
  /\bfdv\b/, /launch token/, /token launch/, /\btoken\b.*(?:launch|price|airdrop)/,
  /\bsolana\b/, /\bxrp\b/, /\bripple\b/, /\bcardano\b/,
  /\bavalanche\b.*(?:token|crypto|chain|avax)/, /\bavax\b/,
  /\bpolygon\b.*(?:token|crypto|matic)/, /\bmatic\b/,
  /\bchainlink\b/, /\buniswap\b/, /\baave\b/,
  /\bdogecoin\b/, /\bdoge\b/, /\bshiba\b/, /\bbnb\b/,
  /\bkraken\b.*(?:exchange|crypto|token)/, /\bbybit\b/,
  /\bmicrostrategy\b/, /\bbitboy\b/,
  /\bmegaeth\b/, /\bedgex\b/, /predict\.fun/, /\bpuffpaw\b/, /\bbackpack\b.*(?:fdv|token|launch)/,
  /\busd\.ai\b/, /\bhyperliquid\b/, /\bjupiter\b.*(?:token|sol|swap)/,
  /\bsei\b.*(?:token|chain|network)/, /\bsui\b.*(?:token|chain|network)/,
  /\baptos\b/, /\bcelestia\b/, /\beigenlayer\b/, /\bstarknet\b/, /\bzksync\b/,
  /\barbitrum\b/, /\boptimism\b.*(?:token|chain|op\b)/, /\bbase\b.*(?:chain|l2|token)/,
  /\btron\b.*(?:token|crypto|trx)/, /\bnear\b.*(?:token|protocol|chain)/,
  /\bmetamask\b/, /\bphantom\b.*(?:wallet|solana)/,
  /market cap.*(?:token|crypto|coin|btc|eth|sol)/,
  /(?:token|crypto|coin|btc|eth|sol).*market cap/,
  /all.time high.*(?:eth|btc|bitcoin|ethereum|crypto|sol|xrp)/,
  /\beth\b.*(?:price|reach|\$|all.time)/,
]);

// ─── MACRO ─────────────────────────────────────────────────────────────────────
const MACRO_RE = re([
  /federal reserve/, /\bthe fed\b/, /\bfed\b.*(?:rate|cut|hike|meeting|funds|policy)/,
  /interest rate/, /\binflation\b/, /\bcpi\b/, /\bgdp\b/, /\brecession\b/,
  /\bunemployment\b/, /\bpowell\b/, /\bfomc\b/,
  /\btreasury\b/, /bond yield/, /\bs&p\b/, /\bnasdaq\b/, /dow jones/,
  /stock market/, /\bipo\b/, /\bearnings\b/,
  /\btariff/, /trade war/, /\bdeficit\b/, /debt ceiling/,
  /\bimf\b/, /world bank/, /monetary policy/, /\bfiscal\b/,
  /\boil price\b/, /\bcrude oil\b/, /\bcrude\b.*\$/, /\bgold price\b/, /\bcommodity\b/,
  /\bmsci\b/, /\bdelisted\b/,
  /\bsaudi aramco\b/, /largest company.*market cap/, /\bshort squeeze\b/,
  /\bbrent\b.*(?:oil|\$|price)/, /\bwti\b.*(?:oil|\$|price)/,
  /\brate cut/, /\brate hike/,
]);

// ─── AI / TECH ─────────────────────────────────────────────────────────────────
const AITECH_RE = re([
  /artificial intelligence/,
  /\bopenai\b/, /\bchatgpt\b/, /\bgpt[-‑]?\d/, /\banthropic\b/, /\bclaude\b/,
  /\bgemini\b.*(?:ai|model|google)/, /\bllm\b/, /large language model/,
  /machine learning/, /deep learning/, /neural network/, /model release/,
  /\bnvidia\b/, /semiconductor/,
  /\btesla\b/, /\bspacex\b/, /\belon musk\b/, /\bsam altman\b/,
  /tech company/, /silicon valley/,
  /\brobotics\b/, /\bautonomous\b/, /self[- ]driving/,
  /\bgrok\b/, /\bxai\b/, /\bmistral\b/, /\bperplexity\b/, /\bcursor\b/,
  /\bdeepseek\b/, /hugging face/, /\bagentic\b/,
  /\blovable\b/, /\bnebius\b/,
  /\bbaidu\b.*(?:ai|model)/, /\bmoonshot\b.*(?:ai|model)/,
  /best ai model/, /ai model\b/,
  /\bapple\b.*(?:launch|release|iphone|wwdc|vision pro)/,
  /\bgoogle\b.*(?:launch|release|search|gemini|pixel)/,
  /\bmeta\b.*(?:launch|release|llama|quest|metaverse)/,
  /\bmicrosoft\b.*(?:launch|release|copilot|azure)/,
  /\bamazon\b.*(?:launch|release|alexa|aws)/,
  /\bapp store\b/, /\biphone\b/, /\bandroid\b/,
]);

// ─── ENTERTAINMENT ─────────────────────────────────────────────────────────────
const ENTERTAINMENT_RE = re([
  // Awards
  /academy awards?/, /\boscars?\b/, /\bemmy\b/, /\bgrammy\b/, /\bgolden globe/,
  /\bbafta\b/, /\bsag award/, /\btony award/, /\bcritics.? choice/,
  /best (?:actor|actress|director|picture|film|animated|international|documentary|screenplay|original|supporting)/,
  /\bnobel\b.*(?:prize|peace|literature|physics|chemistry)/,
  // Film & TV
  /\bbox office\b/, /\bgrossing\b/, /\btop grossing\b/, /\bopening weekend\b/,
  /\bmovie\b/, /\bfilm\b.*(?:release|win|award|gross|premiere)/,
  /\btv show\b/, /\bseason \d+\b.*(?:release|premiere|episode)/,
  /\bepisode\b.*(?:release|premiere)/,
  /\bnetflix\b/, /\bdisney\b.*(?:plus|\+|movie|release)/, /\bhbo\b/, /\bhulu\b/,
  /\bamazon prime\b/, /\bstreaming\b/,
  /stranger things/, /toy story/, /\belio\b.*(?:animated|award|film)/,
  /\barco\b.*(?:animated|award|film)/,
  // Music
  /\balbum\b.*(?:release|drop|chart|billboard)/, /\bbillboard\b/,
  /\bspotify\b.*(?:stream|record|chart)/,
  /\btaylor swift\b/, /\bdrake\b.*(?:album|song|release|chart)/,
  /\bkanye\b/, /\bkendrick\b.*(?:album|song|release)/,
  // Eurovision
  /\beurovision\b/,
  // YouTube / social media celebrity
  /\bmrbeast\b/, /\byoutube\b.*(?:view|subscribe|record|video)/,
  /\btiktok\b.*(?:ban|view|viral|download)/, /\binfluencer\b/,
  /\bstreamer\b/, /\btwitch\b.*(?:ban|stream|viewer)/,
  /million.*views/, /views.*(?:week|day|hour)/,
  // Celebrity / pop culture
  /\bkardashian\b/, /\bbeyonce\b/, /\brihanna\b/, /\blady gaga\b/,
  /\bjustin bieber\b/, /\bdoja cat\b/, /\bbillie eilish\b/,
  /\bparis\b.*(?:hilton|fashion)/, /\bfashion week\b/,
  /\broyal family\b/, /\bking charles\b/, /\bprince\b.*(?:harry|william)/,
  /\bmeghan\b.*(?:markle|duchess)/,
]);

// ─── LOW-QUALITY MARKET FILTERS ─────────────────────────────────────────────────

const WEATHER_RE = re([
  /\btemperature\b/, /\brainfall\b/, /\bprecipitation\b/, /\bhumidity\b/,
  /\bforecast\b/, /\bdegrees\b/, /\bcelsius\b/, /\bfahrenheit\b/, /\bweather\b/,
]);

const OBSCURE_LOCAL_ELECTION_RE = re([
  /\bcity council\b/, /\bmayor of\b/, /\bdistrict\b/, /\bcounty\b/,
  /\blocal election\b/, /\bmunicipal\b/, /\bward\b/, /\bconstituency\b/,
]);

const MAJOR_COUNTRY_RE = re([
  /\bunited states\b/, /\busa\b/, /\bu\.s\.\b/, /\bamerica\b/,
  /\bunited kingdom\b/, /\buk\b/, /\bbritain\b/, /\bengland\b/,
  /\bcanada\b/, /\baustralia\b/, /\bgermany\b/, /\bfrance\b/, /\bjapan\b/,
  /\bindia\b/, /\bchina\b/, /\bbrazil\b/, /\bmexico\b/, /\brussia\b/,
  /\bitaly\b/, /\bspain\b/, /\bsouth korea\b/, /\bindonesia\b/,
  /\bturkey\b/, /\bsaudi arabia\b/, /\bnigeria\b/, /\bsouth africa\b/,
]);

const NICHE_FDV_RE = re([
  /\bfdv\b/, /fully diluted/, /\btoken launch\b/,
  /one day after launch/, /day after launch/,
]);

/**
 * Returns true if the market should be EXCLUDED based on low-quality keyword filters.
 */
export function isLowQualityMarket(question: string, probs: number[]): boolean {
  // Weather markets
  if (WEATHER_RE.test(question)) return true;

  // Obscure local elections (unless a major country is mentioned)
  if (OBSCURE_LOCAL_ELECTION_RE.test(question) && !MAJOR_COUNTRY_RE.test(question)) return true;

  // Niche FDV token launches
  if (NICHE_FDV_RE.test(question)) return true;

  // Near 50/50 ambiguous markets — ALL outcomes between 45% and 55%
  if (probs.length >= 2 && probs.every(p => p >= 0.45 && p <= 0.55)) return true;

  return false;
}

// ─── Uppercase "AI" check (case-sensitive) ─────────────────────────────────────
function looksLikeAI(question: string): boolean {
  return /\bAI\b/.test(question);
}

export function classifyCategory(question: string, tags?: { label: string }[]): MarketCategory {
  const tagLabels = (tags ?? []).map((t) => t.label.toLowerCase());

  // ── Sports first: catches team names, "vs.", "win on <date>" before other rules
  if (tagLabels.some((l) => /sport|nba|nfl|soccer|football|baseball|hockey|tennis|golf|cricket|rugby|esport/.test(l)) ||
      SPORTS_RE.test(question)) return 'SPORTS';

  // ── Entertainment: awards, movies, TV, music, celebrities
  if (tagLabels.some((l) => /entertainment|movie|film|music|award|celeb|culture/.test(l)) ||
      ENTERTAINMENT_RE.test(question)) return 'ENTERTAINMENT';

  // ── Politics: geopolitical events, elections, named politicians
  if (tagLabels.some((l) => /politic|election|president|parliament|government/.test(l)) ||
      POLITICS_RE.test(question)) return 'POLITICS';

  // ── Crypto
  if (tagLabels.some((l) => /crypto|bitcoin|ethereum|solana|blockchain|defi/.test(l)) ||
      CRYPTO_RE.test(question)) return 'CRYPTO';

  // ── Macro / economics
  if (tagLabels.some((l) => /macro|econom|fed\b|finance/.test(l)) ||
      MACRO_RE.test(question)) return 'MACRO';

  // ── AI / Tech
  if (tagLabels.some((l) => /\bai\b|artificial intelligence|tech|software|machine learning/.test(l)) ||
      AITECH_RE.test(question) || looksLikeAI(question)) return 'AI/TECH';

  return 'OTHER';
}

const PAGE_SIZE = 100;
const TARGET_MARKETS = 2000;

export async function fetchPolymarkets(): Promise<NormalisedMarket[]> {
  const allMarkets: GammaMarket[] = [];

  for (let offset = 0; offset < TARGET_MARKETS; offset += PAGE_SIZE) {
    const url = `${GAMMA_API}/markets?active=true&closed=false&limit=${PAGE_SIZE}&offset=${offset}&order=endDate&ascending=true`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Gamma API error: ${res.status}`);
    const page = await res.json() as GammaMarket[];
    allMarkets.push(...page);
    if (page.length < PAGE_SIZE) break; // no more pages
  }

  const markets = allMarkets;
  const results: NormalisedMarket[] = [];

  for (const m of markets) {
    const volume = parseFloat(m.volume ?? '0');
    // Quick gate: skip anything below the lowest possible threshold
    if (volume < MIN_VOLUME_CRYPTO_MACRO) continue;
    if (!m.active || m.closed) continue;

    let outcomes: string[];
    let initialProbs: number[];

    try {
      outcomes = JSON.parse(m.outcomes);
      const prices = JSON.parse(m.outcomePrices).map(Number);
      // Normalise prices to sum to 1
      const total = prices.reduce((a: number, v: number) => a + v, 0);
      initialProbs = prices.map((p: number) => p / total);
    } catch {
      continue; // skip malformed markets
    }

    if (outcomes.length < 2) continue;

    // Filter out low-quality markets
    if (isLowQualityMarket(m.question, initialProbs)) continue;

    // Category-aware volume threshold: $50k for CRYPTO/MACRO, $500k for all others
    const category = classifyCategory(m.question, m.tags);
    const minVol = (category === 'CRYPTO' || category === 'MACRO') ? MIN_VOLUME_CRYPTO_MACRO : MIN_VOLUME;
    if (volume < minVol) continue;

    const b = computeB(volume);
    const quantities = bootstrapQuantities(initialProbs, b);

    // The correct Polymarket URL uses the EVENT slug, not the market slug.
    // The events array is present in the /markets response.
    const eventSlug = m.events?.[0]?.slug ?? m.slug;

    results.push({
      polymarket_id: m.id,
      question: m.question,
      category,
      slug: eventSlug,
      polymarket_url: eventSlug ? `https://polymarket.com/event/${eventSlug}` : '',
      volume,
      b_parameter: b,
      outcomes,
      quantities,
      initial_probs: initialProbs,
      closes_at: m.endDate ?? null,
    });
  }

  return results;
}

// ─── Lightweight per-market status check for integrity sync ────────────────────

export interface MarketStatusResult {
  active: boolean;
  closed: boolean;
  endDate: string | null;
}

export async function fetchMarketStatus(polymarketId: string): Promise<MarketStatusResult | null> {
  try {
    const res = await fetch(`${GAMMA_API}/markets/${polymarketId}`);
    if (!res.ok) return null;
    const data = await res.json() as GammaMarket;
    return { active: data.active, closed: data.closed, endDate: data.endDate ?? null };
  } catch {
    return null;
  }
}
