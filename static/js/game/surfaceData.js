export const SURFACE_TYPES = {
  FAIRWAY: 'fairway',
  GREEN: 'green',
  HOLE: 'hole',
  ROUGH: 'rough',
  SAND: 'sand',
  WATER: 'water',
  WOOD: 'wood',
  ROCK: 'rock',
  OB: 'ob',
  LEAF: 'leaf',
  ROAD: 'road',
  DEFAULT: 'default',
};

// Texture mapping arrays mapped to the logical types based on folder structure
export const SURFACE_TEXTURE_MAP = {
  [SURFACE_TYPES.FAIRWAY]: [
    'Image09569850_09558D90',
    'Image0956CE90_0956D720',
    'Image09588910_0957B220',
    'Image095295F0_0952A680', 'Image0952FEC0_09530F50'
  ],
  [SURFACE_TYPES.GREEN]: [
    'Image0956E000_0956DBB0',
    'Image0952D480_0952E510'
  ],
  [SURFACE_TYPES.LEAF]: [
    'Image09519F90_0951A820',
    'Image09520350_0951B9D0',
    'Image095213E0_09522470',
    'Image09524FF0_09522900',
    'Image09525840_095268D0',
    'Image0952E190_09528F50',
    'Image0953C8B0_09549420',
    'Image09548390_09532AB0',
    'Image0954A590_0954B620',
    'Image0954D940_0954D4F0',
    'Image095522F0_09553E80',
    'Image09554310_095569E0',
    'Image09557B90_09558020',
    'Image0955AB80_095584B0',
    'Image095606E0_095519D0',
    'Image0959BD10_0959C1A0',
    'Image0959ECA0_0959C630',
    'Image0959FD30_0959CA80',
    'Image095A63E0_095A1AA0',
    // Wiz Wiz
    'Image0950AB30_0950BB80', 'Image09518570_095195C0', 'Image0951F680_0951A770', 'Image09520710_0951AC00', 'Image09524C00_09525C90', 'Image09527560_09524770', 'Image09538960_095399F0', 'Image095425B0_09543600', 'Image09555D10_09554360', 'Image09559EB0_0955A700', 'Image0955AB90_0956DB80', 'Image0955F9D0_09556DA0', 'Image09561A60_09557F10', 'Image09565AF0_095583A0', 'Image0956FDB0_09570640', 'Image09573040_09570AD0', 'Image09573D60_095738D0', 'Image095909F0_09591A80'
  ],
  [SURFACE_TYPES.OB]: [
    'Image09579870_09574DA0',
    'Image095947E0_09595870',
    // Wiz Wiz
    'Image0952E9A0_0952FA30'
  ],
  [SURFACE_TYPES.ROAD]: [
    'Image09590DE0_0958E710',
  ],
  [SURFACE_TYPES.ROCK]: [
    'Image09564770_09551E60',
    'Image0958EBA0_09592E70',
    'Image095932C0_09594350',
    'Image09599760_09596190',
    'Image095AB4C0_095A48E0',
    'Image095AF550_095A4D70',

    // Wiz Wiz
    'Image09535720_09535FB0','Image09536440_095384D0','Image0953B8E0_0953BD70','Image095465E0_0953C200','Image09548350_09548BE0','Image09549070_0954A100','Image0954A590_0954B620','Image0954BAB0_0954C300','Image0954C790_0954D020','Image0954D4B0_0954E540','Image0954E9D0_0954FA60','Image0954FEF0_09550F40','Image095513D0_095531B0','Image09582B20_0956F920','Image0958DA00_0958DE90','Image095900D0_09590560','Image09591F10_095923A0','Image09594940_095969D0','Image09598650_09578BA0','Image0959EBE0_0957C6B0','Image095A6320_0957CF90','Image095AA3B0_0957D420','Image095AE440_0957D8B0','Image095B24D0_0957DD40','Image095B6560_0958E320','Image095BA5F0_0958E7B0'

  ],
  [SURFACE_TYPES.ROUGH]: [
    'Image095293E0_0952A470',
    'Image0952A900_0952B990',
    'Image095687C0_09558900',
    'Image0956B970_0956CA00',
    'Image0957CEF0_0957A900',
    'Image09583830_09570630',
    'Image09587880_0957AD90',
    'Image095986D0_09595D00',

    // Wiz Wiz
    'Image0952AB10_0952BBA0','Image09547670_09547EC0'

  ],
  [SURFACE_TYPES.SAND]: [
    'Image0956A8E0_0955BC10',
    'Image09570A80_09571310',
    'Image09573D10_095717A0',

    // Wiz Wiz
    'Image095313E0_09532470','Image0953B050_095328C0','Image09579030_09579480'
  ],
  [SURFACE_TYPES.WATER]: [
    'Image0959A7F0_0959B880',
    'Image0960AE40_095FDEA0'
  ],
  [SURFACE_TYPES.WOOD]: [
    'Image095192B0_09519B00',
    'Image0951ACB0_0951B540',
    'Image09528270_09528AC0',
    'Image0952BE20_0952C6B0',
    'Image09532220_0952CB00',
    'Image09532F00_0953C420',
    'Image095498B0_0954A100',
    'Image0954BAB0_0954C340',
    'Image0954C7D0_0954D060',
    'Image09556E70_09557700',
    'Image095A0D80_095A1610',
    'Image095A1F30_095A3FC0',
    'Image095AA470_095A4450',
    'Image095B3BF0_095B4480',
    'Image095B4910_095B89A0',

    // Wiz Wiz
    'Image09509E10_0950A6A0','Image09519A50_0951A2E0','Image095217A0_095242E0','Image09553640_09553ED0','Image09557230_09557A80','Image09586BB0_0957CB00' 
  ],
  [SURFACE_TYPES.HOLE]: [
    // Blue Lagoon
    'Image0960BED0',

    // Wiz Wiz
    'Image096106E0'
  ],
};

// Based on current game defaults in `constants.js`
const DEFAULT_PHYSICS = {
  bounceRestitution: 0.4,
  impactFriction: 0.11,
  landingSlidingFriction: 1.2,
  landingBrakeFriction: 1.0,
  rollingResistance: 0.12,
  staticFriction: 0.28,
};

export const SURFACE_PHYSICS_PROPERTIES = {
  [SURFACE_TYPES.FAIRWAY]: {
    ...DEFAULT_PHYSICS,
  },
  [SURFACE_TYPES.GREEN]: {
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.25, // less bounce on green
    rollingResistance: 0.02, // very fast rolling
    staticFriction: 0.08,
  },
  [SURFACE_TYPES.ROUGH]: {
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.2, // less bounce
    impactFriction: 0.2, // more tangential friction upon hit
    landingBrakeFriction: 2.0, // stops faster
    rollingResistance: 0.4, // much more drag
    staticFriction: 0.35, // holds harder against slopes
  },
  [SURFACE_TYPES.SAND]: {
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.05, // splats largely dead
    impactFriction: 0.3, // high drag inside sand upon hit
    landingBrakeFriction: 2.5, // digs in quickly
    rollingResistance: 1.0, // very high drag when rolling in sand
    staticFriction: 0.6,
  },
  [SURFACE_TYPES.ROCK]: {
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.6, // very bouncy
    impactFriction: 0.05, // very little slip stop
    landingSlidingFriction: 0.6, // glides easier
    landingBrakeFriction: 0.4,
    rollingResistance: 0.08, // rolls decently 
    staticFriction: 0.2,
  },
  [SURFACE_TYPES.WATER]: {
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.01,
    impactFriction: 0.5,
    landingBrakeFriction: 4.0, // sinks and dies quickly
    rollingResistance: 2.0,
    staticFriction: 1.0,
  },
  [SURFACE_TYPES.WOOD]: {
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.5,
    impactFriction: 0.08,
    rollingResistance: 0.1,
  },
  [SURFACE_TYPES.ROAD]: {
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.45,
    impactFriction: 0.08,
    landingBrakeFriction: 0.6,
    rollingResistance: 0.06,
  },
  [SURFACE_TYPES.LEAF]: {
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.1, // eats the ball
    impactFriction: 0.3,
  },
  [SURFACE_TYPES.OB]: {
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.1,
    rollingResistance: 2.0, // immediately start to die
  },
  [SURFACE_TYPES.DEFAULT]: {
    // Treat unknown as rocky out of bounds profile per prompt instruction "solid as almost rock"
    ...DEFAULT_PHYSICS,
    bounceRestitution: 0.6,
    impactFriction: 0.05,
    landingSlidingFriction: 0.6,
    landingBrakeFriction: 0.6,
    rollingResistance: 0.1,
    staticFriction: 0.25,
  },
};
