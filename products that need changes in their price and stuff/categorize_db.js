const fs = require('fs');
const { parse } = require('csv-parse/sync');

// ============================================================
// CATEGORY MAPPING RULES (brand/keyword -> existing DB category)
// ============================================================

const CATEGORY_RULES = [
  // Cooling - must be FIRST to catch radiators, etc.
  { keywords: ['radiator', 'aqua elite', 'frozen infinity', 'magic qube', 'peerless vision', 'elite vision', 'trofeo vision', 'grand vision', 'wonder vision', 'liquid cooler', 'aio cooler', 'water cooler', 'cpu cooler', 'air cooler', 'dual tower', 'assassin spirit', 'assassin king', 'assassin x', 'ta120', 'tr 120', 'tr 240', 'tr 360', 'core matrix', 'core vision', 'core matrix vision', 'core matrix v2', 'hydroshift', 'hydroshift ii', 'icemyst'], category: 'Cooling Solutions' },
  { keywords: ['case fan', 'chassis fan', 'argb fan', 'pwm fan', 'tl m12', 'tl m12r', 'tl e12', 'tl ub24', 'tl ub36', 'tl c12c', 'tl m12q', 'tl m12qr', 'uni fan', 'galahad', 'fan '], category: 'Cooling Solutions' },
  { keywords: ['thermal paste', 'tf-x', 'tfx', 'frost x45', 'bending corrector', 'am5 secure frame', 'lga1700-bcf'], category: 'Thermal Paste' },
  
  // Power
  { keywords: ['power supply', 'psu ', 'modular psu', 'atx 3.0', 'pcie 5', '80 plus gold', '80 plus platinum', '80 plus bronze', '80 plus titanium', 'sp 850', 'sp 1000', 'tp 1650', 'at 1650', 'sg 750', 'kg 750', 'ag 1000', 'tb 650s', 'tb 750s', 'tg 750s', 'tg 850s'], category: 'Power Supply (PSU)' },
  { keywords: ['psu extension', 'extension cable', '12vhpwr', '12v hpwr'], category: 'PSU Extension Cables' },
  
  // Casing
  { keywords: ['case ', 'chassis', 'mid tower', 'full tower', 'mini tower', 'micro atx', 'atx case', 'e-atx', 'mini itx', 'o11', 'lancool', 'lancool 2', 'vision', 'dynamic', 'airflow', 'mesh ', 'tempered glass', 'far a', 'fara ', 'r1 pro', 'r1pro'], category: 'Casing' },
  { keywords: ['chassis accessory', 'fan splitter', 'fan hub', 'rgb controller', 'fan controller', 'gpu bracket', 'gpu kit', 'vertical gpu', 'pci bracket'], category: 'Chassis Accessories' },
  
  // Memory
  { keywords: ['ddr4', 'ddr5', 'memory kit', 'ram ', 'memory ', 'udimm', 'so-dimm', 'cl30', 'cl32', 'cl36', 'cl40', '6000mhz', '5600mhz', '4800mhz', '3600mhz', '3200mhz', 'spectrix', 'lancer', 'valor air'], category: 'Memory (RAM)' },
  { keywords: ['ssd ', 'nvme', 'm.2', '2.5\" ssd', 'sata ssd', 'gen3', 'gen4', 'gen5', 'pcie 4.0', 'pcie 5.0', 'wd blue', 'wd black', 'samsung 990', 'lexar nm', 'hiksemi', 'ramsta', 'alpha pro', 'crucial p3', 'silicon power', 'apacer', 'kingston', 'colorful cn', 'oscoo'], category: 'Storage' },
  { keywords: ['hdd ', 'hard drive', '3.5\"', 'nas ', 'enterprise drive'], category: 'Storage' },
  
  // Motherboard
  { keywords: ['motherboard', 'mobo ', 'h510', 'h610', 'b660', 'b760', 'b850', 'b860', 'z690', 'z790', 'z890', 'x570', 'x670', 'x870', 'a520', 'a620', 'b550', 'b650', 'trx40', 'strx4', 'lga1700', 'lga1851', 'am4', 'am5', 'prime ', 'tuf gaming', 'rog strix', 'rog maximus', 'rog crosshair', 'proart ', 'msi ', 'mag ', 'mpg ', 'pro ', 'bomber', 'project zero', 'tomahawk', 'godlike'], category: 'Motherboard' },
  
  // GPU
  { keywords: ['rtx 5090', 'rtx 5080', 'rtx 5070', 'rtx 5060', 'rtx 5050', 'rtx 4090', 'rtx 4080', 'rtx 4070', 'rtx 4060', 'rtx 3090', 'rtx 3080', 'rtx 3070', 'rtx 3060', 'rtx 3050', 'rtx 2080', 'rtx 2070', 'rtx 2060', 'gtx 1660', 'gtx 1650', 'rx 9070', 'rx 7900', 'rx 7800', 'rx 7700', 'rx 7600', 'rx 6900', 'rx 6800', 'rx 6700', 'rx 6600', 'graphics card', 'gpu ', 'ventus', 'shadow', 'gaming x', 'trio', 'suprim', 'vanguard', 'astral', 'dual ', 'tuf gaming', 'rog strix', 'prime ', 'phantom', 'phantom gaming', 'challenger', 'terminator', 'swift ', 'pny ', 'zotac ', 'gainward', 'palit', 'inno3d', 'colorful ', 'asus ', 'msi ', 'gigabyte '], category: 'Graphics Cards (GPU)' },
  
  // Monitors
  { keywords: ['monitor', '\" fhd', '\" qhd', '\" 2k', '\" 4k', '\" uhd', 'ips panel', 'va panel', 'tn panel', 'oled', 'qled', 'curved', 'ultrawide', 'gaming monitor', 'freesync', 'gsync', 'hdr', 'hz ', 'hz,', 'hz.', '144hz', '165hz', '170hz', '180hz', '240hz', '360hz', '500hz', 'ips,', 'va,', 'qhd', 'uhd', 'wqhd', 'uwqhd', 'proart ', 'tuf ', 'rog ', 'xg27', 'pg27', 'vg27', 'pa27', 'xg32', 'pg32', 'pa32', 'xg34', 'pg34', 'xg43', 'pg43', 'xg49', 'mp242', 'mp273', 'mag 27', 'mag 32', 'optix', 'g274', 'g321', 'g244'], category: 'Monitors' },
  
  // Laptops - MUST BE BEFORE GPU/Storage/Memory rules
  { keywords: ['laptop', 'notebook', 'gaming laptop', 'rog ', 'tuf gaming', 'zephyrus', 'strix scar', 'strix g', 'flow ', 'vivobook', 'expert center', 'victus', 'omen', 'legion', 'alienware', 'razer blade', 'msi ', 'asus ', 'hp ', 'dell ', 'lenovo ', 'msi katana', 'msi pulse', 'msi raider', 'msi vector', 'msi crosshair', 'msi sword', 'msi stealth', 'msi creator', 'msi prestige', 'msi modern', 'msi summit', 'alpha ', 'delta ', 'bravo ', 'expert center', 'victus', 'envy ', 'pavilion', 'inspiron', 'latitude', 'precision', 'xps ', 'macbook', 'mac book', 'ideapad', 'thinkpad', 'think book'], category: 'Gaming Laptops' },
  { keywords: ['rog ally', 'ally ', 'handheld'], category: 'ROG ALLY' },
  { keywords: ['tuf gaming', 'tuf ', 'tuf ', 'tuf '], category: 'Gaming Laptops > TUF gaming' },
  { keywords: ['rog ', 'asus ', 'asus ', 'asus '], category: 'Gaming Laptops > ROG' },
  
  // Mini PC
  { keywords: ['mini pc', 'nuc ', 'nuc1', 'nuc2', 'nuc3', 'nuc4', 'nuc5', 'nuc6', 'nuc7', 'nuc8', 'nuc9', 'nuc10', 'nuc11', 'nuc12', 'nuc13', 'nuc14', 'asus nuc', 'intel nuc', 'simplynuc', 'expert center', 'expertcenter'], category: 'Mini PC (NUC)' },
  
  // CPU
  { keywords: ['ryzen 9', 'ryzen 7', 'ryzen 5', 'ryzen 5 7600', 'ryzen 5 5600', 'ryzen 7 7800', 'ryzen 7 5800', 'ryzen 9 7900', 'ryzen 9 5900', 'core i9', 'core i7', 'core i5', 'core i3', 'intel core', 'amd ryzen', 'processor', 'cpu ', 'lga1700', 'lga1851', 'am4', 'am5', 'box ', 'tray '], category: 'Processors (CPU)' },
  
  // Input Devices - Mousepad BEFORE Mouse
  { keywords: ['mousepad', 'mouse pad', 'desk mat', 'extended mousepad', 'xl mousepad', 'xxl mousepad', 'cloth pad', 'hard pad', 'rgb mousepad', 'steelseries qck', 'glorious ', 'artisan ', 'xraypad', 'esports tiger', 'lethal gaming', 'endgame ', 'pulsar ', 'aquacontrol', 'aq+', 'aq+', 'ac+', 'ac+'], category: 'Mousepad' },
  { keywords: ['mouse ', 'gaming mouse', 'wireless mouse', 'wired mouse', 'lightweight mouse', 'trackball', 'viper ', 'deathadder', 'basilisk', 'naga ', 'orochi', 'kone ', 'kain ', 'bursts ', 'model o', 'model d', 'g pro', 'gpro', 'mx master', 'mx vertical', 'mx anywhere', 'm185', 'm240', 'm325', 'm330', 'm331', 'm550', 'm650', 'g304', 'g305', 'g309', 'g502', 'g703', 'g903', 'pro x superlight', 'katar', 'kone pro', 'burst pro', 'kone xp', 'x11', 'x3', 'x3max', 'x68', 'x98', 'l80', 'l90', 'l30', 'g500', 'attack shark', 'attck shark', 'pulsar', 'glorious ', 'endgame ', 'xray ', 'ninjutso', 'vaxee ', 'lamzu ', 'ninjutso', 'x2v2', 'x2', 'x2v2', 'x2v2'], category: 'Mouse' },
  { keywords: ['keyboard', 'mechanical keyboard', 'gaming keyboard', 'wireless keyboard', 'wired keyboard', 'tkl ', '60% ', '65% ', '75% ', 'full size', 'aluminum', 'hot swap', 'magnetic switch', 'hall effect', 'rapid trigger', 'akko ', 'keychron', 'nuphy ', 'monsgeek', 'aula ', 'attack shark', 'attck shark', 'x68', 'x98', 'x3', 'f108', 'f99', 'g7', 'l80', 'l90', 'l30', 'g500', 'k552', 'k120', 'k270', 'k380', 'k480', 'k780', 'k810', 'k840', 'mx keys', 'mx mechanical', 'pop keys', 'signature', 'mk220', 'mk235', 'mk250', 'mk270', 'mk345', 'mk540', 'mk850'], category: 'Keyboard' },
  
  // Audio
  { keywords: ['headset', 'gaming headset', 'wireless headset', 'bluetooth headset', 'usb headset', '3.5mm headset', 'surround sound', '7.1', 'virtual 7.1', 'noise cancelling', 'anc ', 'arctis', 'siberia', 'kraken', 'blackshark', 'nari', 'barracuda', 'void', 'hs50', 'hs60', 'hs70', 'hs80', 'void pro', 'void elite', 'cloud ', 'cloud ii', 'cloud alpha', 'cloud flight', 'cloud stinger', 'cloud revolver', 'cloud orbit', 'g pro x', 'g pro', 'g335', 'g435', 'g535', 'g733', 'g935', 'g933', 'astros', 'a40', 'a50', 'a10', 'a20', 'turtle beach', 'stealth', 'recon', 'elite atlas', 'elite pro', 'razer ', 'logitech ', 'steelseries ', 'corsair ', 'hyperx ', 'jbl ', 'razer kraken', 'razer blackshark', 'razer nari', 'razer barracuda', 'razer thresher', 'razer man o war', 'razer tiamat', 'razer electra', 'razer megadolon', 'razer chimaera', 'razer orochi', 'razer deathadder', 'razer basilisk', 'razer viper', 'razer krait', 'razer mamba', 'razer naga', 'razer trinity', 'razer basilisk v3', 'razer viper v2', 'razer deathadder v3', 'razer cobra', 'razer cobra pro', 'razer basilisk v3 pro', 'razer viper v2 pro', 'razer deathadder v3 pro', 'razer viper v2 pro', 'razer deathadder v3 pro', 'razer basilisk v3 pro 35k', 'razer viper v2 pro 30k', 'razer deathadder v3 pro 30k', 'razer basilisk v3 35k', 'razer viper v2 pro 30k', 'razer deathadder v3 pro 30k', 'razer basilisk v3 35k', 'razer viper v2 pro 30k', 'razer deathadder v3 pro 30k', 'razer basilisk v3 35k', 'razer viper v2 pro 30k', 'razer deathadder v3 pro 30k'], category: 'Headset' },
  { keywords: ['headphones', 'headphone', 'earbuds', 'earbud', 'tw ', 'tws ', 'true wireless', 'bluetooth earbuds', 'wireless earbuds', 'anc ', 'noise cancelling', 'in-ear', 'over-ear', 'on-ear', 'open-ear', 'bone conduction', 'jbl ', 'tune ', 'live ', 'tour ', 'reflect ', 'endurance ', 'club ', 'wave ', 'beam ', 'pulse ', 'charge ', 'flip ', 'xtreme ', 'boombox ', 'partybox ', 'go ', 'clip ', 'charge 5', 'flip 6', 'xtreme 3', 'partybox 100', 'partybox 310', 'partybox 710', 'partybox 110', 'partybox 300', 'boombox 2', 'boombox 3', 'go 3', 'go 4', 'clip 4', 'clip 5', 'charge 5', 'flip 6', 'xtreme 3', 'xtreme 4', 'partybox 100', 'partybox 310', 'partybox 710', 'partybox 110', 'partybox 300', 'boombox 2', 'boombox 3', 'go 3', 'go 4', 'clip 4', 'clip 5'], category: 'Headphones' },
  { keywords: ['earbuds', 'tws', 'true wireless', 'airpods', 'galaxy buds', 'pixel buds', 'nothing ear', 'sony wf', 'sony linkbuds', 'jabra elite', 'jabra evolve', 'sennheiser', 'momentum', 'technics', 'eah-', 'ea-', 'cxe', 'cx ', 'cxe', 'fie', 'fii', 'fiil', 'moon', 'moon ', 'moondrop', 'moon drop', 'dusk', 'aria', 'starfield', 'solstice', 'blessing', 'blessing 2', 'blessing 3', 'dusk 2', 'aria 2', 'starfield 2', 'solstice 2'], category: 'Earbuds' },
  
  // Webcam
  { keywords: ['webcam', 'camera ', 'hd webcam', '4k webcam', '1080p webcam', '720p webcam', 'streaming camera', 'conference camera', 'logitech c', 'logitech brio', 'logitech streamcam', 'razer kiyo', 'elgato facecam', 'dell webcam', 'microsoft lifecam', 'anker powerconf', 'ankerwork', 'mevo ', 'insta360', 'obsbot '], category: 'Webcam' },
  
  // Microphone
  { keywords: ['microphone', 'mic ', 'usb mic', 'xlr mic', 'condenser mic', 'dynamic mic', 'streaming mic', 'podcast mic', 'shotgun mic', 'lavalier', 'lav mic', 'clip mic', 'blue yeti', 'blue snowball', 'elgato wave', 'shure mv7', 'shure sm7b', 'rodecaster', 'rodecaster ii', 'focusrite', 'scarlett', 'vocaster', 'audient', 'evo 4', 'evo 8', 'evo 16', 'ssl 2', 'ssl 2+', 'm-track', 'm-track solo', 'm-track duo', 'um2', 'umc22', 'umc202', 'umc204', 'umc404', 'umi ', 'umx ', 'mic', 'mic ', 'mic ', 'mic '], category: 'Microphone' },
  
  // Speaker
  { keywords: ['speaker', 'bluetooth speaker', 'portable speaker', 'party speaker', 'soundbar', 'bookshelf speaker', 'floor speaker', 'subwoofer', 'jbl ', 'partybox', 'boombox', 'charge ', 'flip ', 'xtreme ', 'go ', 'clip ', 'pulse ', 'beam ', 'soundbar', 'sound bar', 'home theater', 'surround sound', 'dolby', 'dts', 'atmos', 'bluetooth speaker', 'portable bluetooth', 'waterproof speaker', 'outdoor speaker', 'marine speaker', 'rugged speaker', 'floating speaker', 'shower speaker', 'karaoke speaker', 'karaoke mic', 'wireless mic', 'mic system', 'mic kit'], category: 'Speakers' },
  
  // Gaming Chair/Desk
  { keywords: ['gaming chair', 'office chair', 'ergonomic chair', 'racing chair', 'mesh chair', 'leather chair', 'fabric chair', 'secretlab', 'noblechairs', 'dxracer', 'akracing', 'vertagear', 'andaseat', 'corsair ', 'razer ', 'logitech ', 'cougar ', 'cooler master', 'hyperx ', 'asus ', 'rog ', 'tuf ', 'gtplayer', 'gtracing', 'dowinx', 'homall', 'bestoffice', 'sytas', 'auto', 'auto ', 'auto '], category: 'Gaming Chair' },
  { keywords: ['gaming desk', 'standing desk', 'sit stand desk', 'electric desk', 'height adjustable', 'l-shaped', 'corner desk', 'carbon fiber', 'mouse pad desk', 'desk mat', 'extended desk', 'eureka ', 'fezibo', 'vari ', 'uplift', 'flexispot', 'autonomous', 'irock', 'jax', 'jax ', 'jax '], category: 'Gaming Desk' },
  
  // Monitor Arm
  { keywords: ['monitor arm', 'monitor mount', 'vga mount', 'desk mount', 'wall mount', 'gas spring', 'articulating arm', 'dual monitor', 'triple monitor', 'quad monitor', 'single monitor', 'heavy duty', 'vga 100', 'vga 75', 'vga 200', 'vga 300', 'ergo', 'ergotron', 'loctek', 'north bayou', 'huanuo', 'mount-it', 'vivo ', 'vivo ', 'vivo '], category: 'Monitor Arm' },
  
  // Networking
  { keywords: ['router', 'wifi router', 'mesh router', 'wifi 6', 'wifi 6e', 'wifi 7', 'ax3000', 'ax5400', 'ax6000', 'ax11000', 'be11000', 'be19000', 'be27000', 'mesh system', 'deco ', 'orbi ', 'eero ', 'google wifi', 'nest wifi', 'asus ', 'netgear ', 'tp-link ', 'linksys ', 'ubiquiti ', 'unifi ', 'amplifi ', 'd-link ', 'tenda ', 'mercusys ', 'xiaomi ', 'huawei ', 'honor ', 'realme ', 'oppo ', 'oneplus ', 'vivo ', 'poco ', 'redmi '], category: 'Routers' },
  { keywords: ['switch', 'network switch', 'managed switch', 'unmanaged switch', 'poe switch', 'poe+', 'poe++', 'sfp+', 'sfp28', 'qsfp+', 'qsfp28', '10g ', '2.5g ', '5g ', '25g ', '100g ', 'netgear ', 'tp-link ', 'ubiquiti ', 'cisco ', 'mikrotik ', 'd-link ', 'tenda ', 'mercusys ', 'zyxel ', 'planet ', 'planet ', 'planet '], category: 'Switches' },
  
  // UPS
  { keywords: ['ups ', 'uninterruptible power supply', 'battery backup', 'surge protector', 'power strip', 'apc ', 'cyberpower', 'eaton ', 'vertiv ', 'liebert ', 'tripp lite', 'powerware ', 'mge ', 'eaton ', 'apc ', 'cyberpower'], category: 'UPS' },
  
  // Projector
  { keywords: ['projector', 'home theater', 'short throw', 'ultra short throw', '4k projector', '1080p projector', 'laser projector', 'led projector', 'lamp projector', 'epson ', 'benq ', 'optoma ', 'viewsonic ', 'lg ', 'sony ', 'panasonic ', 'jvc ', 'christie ', 'barco ', 'digital projection', 'screen ', 'projection screen', 'motorized screen', 'fixed frame screen', 'portable screen', 'tripod screen', 'floor rising', 'ceiling recessed', 'tab tensioned', 'alr screen', 'clr screen', 'ust screen'], category: 'Projectors' },
  { keywords: ['projector screen', 'screen ', 'projection screen', 'motorized screen', 'fixed frame screen', 'portable screen', 'tripod screen', 'floor rising', 'ceiling recessed', 'tab tensioned', 'alr screen', 'clr screen', 'ust screen'], category: 'Projector Screen' },
  
  // Scanner
  { keywords: ['scanner', 'document scanner', 'flatbed scanner', 'sheetfed scanner', 'portable scanner', 'business card scanner', 'photo scanner', 'film scanner', 'slide scanner', 'negative scanner', 'epson ', 'canon ', 'fujitsu ', 'brother ', 'hp ', 'plustek ', 'kodak ', 'plustek ', 'plustek '], category: 'Scanner' },
  
  // Controllers
  { keywords: ['controller', 'gamepad', 'joystick', 'fight stick', 'arcade stick', 'racing wheel', 'racing pedals', 'sim racing', 'logitech g29', 'logitech g920', 'logitech g923', 'thrustmaster', 'fanatec', 'moza', 'simagic', 'simucube', 'vrs ', 'vrs ', 'vrs ', 'haptic', 'force feedback', 'direct drive', 'belt drive', 'gear drive', 'hybrid drive'], category: 'Controllers' },
  
  // Presenters
  { keywords: ['presenter', 'clicker', 'remote', 'laser pointer', 'presentation remote', 'wireless presenter', 'logitech r', 'logitech spotlight', 'kensington ', 'targus ', 'hp ', 'dell ', 'microsoft ', 'canon ', 'hama ', 'hama ', 'hama '], category: 'Presenters' },
  
  // LEDs
  { keywords: ['led ', 'rgb ', 'argb', 'led strip', 'rgb strip', 'argb strip', 'led fan', 'rgb fan', 'argb fan', 'led controller', 'rgb controller', 'argb controller', 'addressable rgb', 'a-rgb', 'a rgb', '5v argb', '12v rgb', '3-pin argb', '4-pin rgb', 'jst ', 'jst ', 'jst '], category: 'LEDs' },
  
  // LCD/Tablet
  { keywords: ['lcd ', 'display ', 'screen ', 'touchscreen', 'touch screen', 'ipad', 'tablet', 'samsung galaxy tab', 'ipad pro', 'ipad air', 'ipad mini', 'surface pro', 'surface go', 'surface laptop', 'surface book', 'surface studio', 'surface hub', 'wacom ', 'huion ', 'xp-pen', 'gaomon ', 'parblo ', 'ugen ', 'ugen ', 'ugen '], category: 'LCD' },
  
  // Graphic Tablet
  { keywords: ['graphic tablet', 'drawing tablet', 'pen display', 'pen tablet', 'wacom ', 'huion ', 'xp-pen', 'gaomon ', 'parblo ', 'ugen ', 'ugen ', 'ugen ', 'kamvas', 'inspiroy', 'decan', 'kamas', 'kamas', 'kamas'], category: 'Graphic Tablet' },
  
  // Mini PC
  { keywords: ['mini pc', 'nuc ', 'nuc1', 'nuc2', 'nuc3', 'nuc4', 'nuc5', 'nuc6', 'nuc7', 'nuc8', 'nuc9', 'nuc10', 'nuc11', 'nuc12', 'nuc13', 'nuc14', 'asus nuc', 'intel nuc', 'simplynuc', 'bean canyon', 'ghost canyon', 'phantom canyon', 'phantom canyon', 'phantom canyon', 'skull canyon', 'hades canyon', 'frost canyon', 'quartz canyon', 'panther canyon', 'wildcat canyon', 'elk canyon', 'moose canyon', 'eagle canyon', 'hawk canyon', 'falcon canyon', 'owl canyon', 'raven canyon', 'condor canyon'], category: 'Mini PC (NUC)' },
  
  // TV
  { keywords: ['tv ', 'television', 'oled tv', 'qled tv', 'neo qled', 'microled', 'mini led', '8k tv', '4k tv', 'smart tv', 'android tv', 'google tv', 'tizen', 'webos', 'fire tv', 'roku tv', 'vidaa', 'lg ', 'samsung ', 'sony ', 'tcl ', 'hisense ', 'xiaomi ', 'oneplus ', 'realme ', 'motorola ', 'nokia ', 'panasonic ', 'philips ', 'sharp ', 'toshiba ', 'vestel ', 'vestel ', 'vestel '], category: 'TV' },
  
  // Wireless
  { keywords: ['wireless adapter', 'wifi adapter', 'bluetooth adapter', 'wifi card', 'bluetooth card', 'pci wifi', 'pci bluetooth', 'usb wifi', 'usb bluetooth', 'ax200', 'ax201', 'ax210', 'ax211', 'be200', 'be201', 'rtl8812', 'rtl8821', 'rtl8822', 'rtl8852', 'mt7921', 'mt7922', 'mt7961', 'qca6174', 'qca6390', 'qca6391', 'intel wifi', 'intel bluetooth', 'killer wifi', 'killer bluetooth', 'rivet networks', 'qualcomm atheros', 'realtek ', 'realtek ', 'realtek '], category: 'WIRELESS ADAPTERs' },
  
  // Gaming Laptops subcategories
  { keywords: ['rog ', 'asus ', 'asus ', 'asus '], category: 'Gaming Laptops > ROG' },
  { keywords: ['tuf gaming', 'tuf ', 'tuf ', 'tuf '], category: 'Gaming Laptops > TUF gaming' },
  
  // Thermal
  { keywords: ['frost x45', 'thermal paste', 'tf-x', 'tfx'], category: 'Thermal Paste' },
];

// ============================================================
// BRAND FALLBACK
// ============================================================

const BRAND_FALLBACK = {
  'ugreen': 'Uncategorized',
  'lian': 'Casing',
  'li': 'Casing',
  'thermalright': 'Cooling Solutions',
  'tr': 'Cooling Solutions',
  'tl': 'Cooling Solutions',
  'logitech': 'Mouse',
  'jbl': 'Speakers',
  'asus': 'Motherboard',
  'hp': 'Gaming Laptops',
  'attack': 'Mouse',
  'xpg': 'Casing',
  'silverstone': 'Power Supply (PSU)',
  'id-cooling': 'Cooling Solutions',
  'colorful': 'Motherboard',
  'hype': 'Gaming Chair',
  'cougar': 'Casing',
  'msi': 'Motherboard',
  'razer': 'Mouse',
  'steelseries': 'Headset',
  'glorious': 'Mouse',
  'corsair': 'Power Supply (PSU)',
  'gigabyte': 'Motherboard',
  'ease': 'Mouse',
  'deepcool': 'Cooling Solutions',
  'darkflash': 'Casing',
  'aigo': 'Mouse',
  'jonsbo': 'Casing',
  'segotep': 'Power Supply (PSU)',
  'be quiet': 'Cooling Solutions',
  'noctua': 'Cooling Solutions',
  'arctic': 'Cooling Solutions',
  'fractal': 'Casing',
  'phanteks': 'Casing',
  'nzxt': 'Casing',
  'hyte': 'Casing',
  'inwin': 'Casing',
  'seasonic': 'Power Supply (PSU)',
  'evga': 'Graphics Cards (GPU)',
  'asrock': 'Motherboard',
  'biostar': 'Motherboard',
  'gainward': 'Graphics Cards (GPU)',
  'palit': 'Graphics Cards (GPU)',
  'zotac': 'Graphics Cards (GPU)',
  'inno3d': 'Graphics Cards (GPU)',
  'thermaltake': 'Cooling Solutions',
  'antec': 'Casing',
  'silverstone': 'Power Supply (PSU)',
};

// ============================================================
// MAIN CATEGORIZATION FUNCTION
// ============================================================

function categorizeProduct(name, existingCategories) {
  const lowerName = name.toLowerCase();
  
  // Check rules in order
  for (const rule of CATEGORY_RULES) {
    for (const keyword of rule.keywords) {
      if (lowerName.includes(keyword.toLowerCase())) {
        if (existingCategories.has(rule.category)) {
          return rule.category;
        }
      }
    }
  }
  
  // Fallback: try first word as brand
  const firstWord = name.split(' ')[0].toLowerCase().replace(/[^a-z0-9-]/g, '');
  if (BRAND_FALLBACK[firstWord]) {
    if (existingCategories.has(BRAND_FALLBACK[firstWord])) {
      return BRAND_FALLBACK[firstWord];
    }
  }
  
  return 'Uncategorized';
}

// ============================================================
// MAIN
// ============================================================

const dbContent = fs.readFileSync('C:/Users/Aimal/Documents/GitHub/Wordpress project/wc-all-products.csv', 'utf-8');
const dbRecords = parse(dbContent, { 
  columns: true, 
  skip_empty_lines: true,
  relax_column_count: true,
  relax_column_count_less: true,
  relax_column_count_more: true
});

console.log('Total products:', dbRecords.length);

// Collect existing categories
const existingCategories = new Set();
for (const r of dbRecords) {
  const cats = (r.Categories || '').split(',').map(c => c.trim());
  for (const c of cats) if (c) existingCategories.add(c);
}

console.log('Existing categories:', existingCategories.size);

// Find and categorize uncategorized products
let updated = 0;
const updates = [];

for (const r of dbRecords) {
  const cat = r.Categories || '';
  const name = r.Name || '';
  const id = r['\ufeffID'] || r.ID || '';
  
  if (!cat || cat.trim() === '' || cat.toLowerCase().includes('uncategorized')) {
    const newCat = categorizeProduct(name, existingCategories);
    if (newCat !== 'Uncategorized') {
      updates.push({ id, oldCat: cat, newCat, name: name.substring(0,80) });
      updated++;
    }
  }
}

console.log('Products to update:', updated);
if (updated > 0) {
  console.log('\nSample updates:');
  updates.slice(0, 30).forEach(u => console.log('  ' + u.id + ' | ' + u.oldCat + ' -> ' + u.newCat + ' | ' + u.name));
}

// Write updates to CSV for review
let csv = 'ID,Old Categories,New Category,Name\n';
for (const u of updates) {
  csv += u.id + ',\"' + u.oldCat + '\",' + u.newCat + ',\"' + u.name + '\"\n';
}
fs.writeFileSync('C:/Users/Aimal/Documents/GitHub/Wordpress project/products that need changes in their price and stuff/category_updates.csv', csv);
console.log('\nWritten category_updates.csv for review');
