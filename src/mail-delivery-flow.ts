/**
 * Day-0 mail delivery tutorial → escalating road ordinances
 * (MainRoad → Maintenance, LeftSideRoad → JayWalking, Yellow Cab → Do Not Step Car,
 *  City Tram → Do Not Step City Tram, Street Lamp tops → Street Lights Climb,
 *  Cargo crates / Park Benches / Logs / Kiosk Wood / Crate Planks Drop on roads/tracks →
 *  No Crates / Bench / Logs / Wood Planks / Scrap Metals on Roads; cone / bush remove →
 *  DontRemoveTheCones / DontRemoveThisBush / DontCutThisPole / Dont Destroy this Sign /
 *  Dont hit the fire hydrant / High Voltage / No cutting of trees).
 *  Wearing a bush across roads queues DontRemoveThisBush; while worn, person MainRoad/
 *  LeftSideRoad feet checks are skipped (disguise, not a walker). Fallen utility poles used
 *  as road platforms queue DontCutThisPole (standing poles never count). Dismantling the
 *  Kanji Sign queues Dont Destroy this Sign; after active, the next dismantle finishes
 *  falling before the soft-loop. Hitting a fire hydrant (axe/rock) to spray water queues
 *  Dont hit the fire hydrant; after active, water sprays ~1s before the soft-loop. Walking
 *  on utility-pole wires without tram / kanji / street-lamp platforms queues High Voltage.
 *  Delivering mail while carrying a tree log that never touched a road queues No cutting of
 *  trees; after active, cutting a tree soft-loops after the log drops appear. Axing ordinance
 *  boards replaces them with fallen dynamic prefabs (road platforms); using those platforms
 *  or dismantling boards queues Do not remove the SIGNS; after active, the next axe lets the
 *  board tip/fall before the soft-loop. Fallen boards also count as scrap metal on roads —
 *  if they hit the road before other scrap (and SIGNS is not yet active), SIGNS unlocks
 *  first; once SIGNS is active, those boards queue No Scrap Metals on Roads. Standing on
 *  street-lamp Metal Scrapt over a road without that scrap resting on asphalt queues
 *  Dont destroy the street lights; Metal Scrapt resting on a road always queues No Scrap
 *  Metals. After Dont destroy is active, the next lamp dismantle soft-loops after scrap
 *  appears. Throwing a peach to lure the Cat queues Dont feed the cat; click the cat within
 *  2.5m to have it carry mail to the mailbox. After active, the next peach lure soft-loops
 *  when the cat reaches the fruit. The cat also patrols (mailbox → cherry tree → wires →
 *  shophouse roofs → back); clicking it without a peach lure queues No cats on streets
 *  (board: Cats). After that ordinance is active, clicking the unfed cat soft-loops.
 *  Climbing a standing cherry canopy (TreeTrigger) then delivering mail queues No climbing
 *  on the tree (board: Trees Climbing); after active, stepping on the canopy soft-loops.
 *  Dismantling the Trail Map Kiosk and using its wood as a platform without resting parts on
 *  a road (e.g. hung on wires) then delivering mail queues Dont remove this kiosk (board:
 *  Kiosk); after active, the next kiosk dismantle soft-loops after the parts appear.
 *
 * Flow:
 * 1. Speech bubble + close camera on player (3m) for 5s, then ~2s smooth zoom to 20m
 * 2. Highlight mailbox (red pulse) + arrow trail
 * 3. Player approaches and left-clicks mailbox to deliver (2.5m, green outline hover)
 * 4. Stepping on MainRoad* / LeftSideRoad* / Yellow Cab / City Tram / LampTrigger, placing a
 *    cargo crate / park bench / log / kiosk wood / crate planks / metal scrap on roads/tracks,
 *    wearing a bush across roads, using a traffic cone or fallen utility pole as a platform
 *    over a road, finishing a traffic-cone axe dismantle (5th hit), or dismantling the Kanji
 *    Sign, or releasing fire-hydrant water (axe/rock), or walking utility-pole wires without
 *    tram / kanji / street-lamp platforms, or delivering while carrying a tree log that never
 *    touched a road. Violation ordinances (roads / litter / hydrant / bush / cone axe) queue
 *    at most ONE new ordinance for the next day (first broken). Delivery-route ordinances
 *    (climbs, platforms, cat, clean log/kiosk/tree) are candidate-tracked and the successful
 *    delivery picker chooses which one unlocks — last enabling method wins, with a static
 *    priority tie-break.
 * 5. After delivery: mailbox close-up + envelope insert → fade black → teleport + prop reset
 *    → "the Next Day..." → fade in on newly revealed ordinance → zoom out to player
 * 6. Later: repeating the same break focuses that ordinance + instant teleport home
 *    (no black / next day) → zoom out to player.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { createAirmailEnvelope, disposeAirmailEnvelope } from './airmail-envelope.js';
import { CatMailCourier } from './cat-mail-courier.js';
import { ThirdPersonPlayer } from './player.js';

const INTRO_CAMERA_DISTANCE = 3;
const DEFAULT_CAMERA_DISTANCE = 20;
/** Close-up cinematic distance in front of mailbox / ordinance models. */
const MODEL_FOCUS_DISTANCE = 2;
const SPEECH_DURATION_SEC = 3;
/** Smooth intro zoom-out from close → default. */
const INTRO_ZOOM_OUT_SEC = 2;
const ORDINANCE_FOCUS_SEC = 2;
/** Hold after envelope finishes before fading to black. */
const DELIVERY_POST_INSERT_SEC = 0.55;
/** Smooth blend from gameplay cam into model-front cinematic. */
const CINEMATIC_BLEND_SEC = 1.15;
/** Smooth blend from ordinance cinematic back to the player cam. */
const CINEMATIC_RETURN_SEC = 2.4;
const FADE_SEC = 0.85;
const NEXT_DAY_LABEL_SEC = 2;
/** Solid road cue after first reveal or breaking active Maintenance / Jaywalking ordinances. */
const ROAD_HIGHLIGHT_DURATION_SEC = 2;
/** Black-screen staging: hide scrap, then retire, then restore, then reveal. */
const DAY_TRANSITION_SCRAP_RETIRE_SEC = 0.2;
/** Let renderer resource retirement settle before beginning the reset. */
const DAY_TRANSITION_WORLD_RESTORE_SEC = 0.9;
/** Cooldown between the completed world restore and ordinance reveal. */
const DAY_TRANSITION_REVEAL_COOLDOWN_SEC = 0.35;
/** Cooldown between revealing assets and starting the cinematic camera work. */
const DAY_TRANSITION_CINEMATIC_COOLDOWN_SEC = 0.35;
/** Maximum authored props restored per frame while the screen is black. */
const DAY_TRANSITION_RESTORE_BATCH_SIZE = 4;
const DELIVER_MAX_DISTANCE = 2.5;
/** Pool capacity; only arrows that fit on the current route are rendered. */
const TRAIL_ARROW_MAX_COUNT = 32;
/** Constant player-to-target gap between consecutive arrows, in world units. */
const TRAIL_ARROW_SPACING = 1.0;
/** Arrow.png source aspect ratio (288 × 406); preserve it rather than stretching the chevron. */
const TRAIL_ARROW_ASPECT_RATIO = 288 / 406;
const TRAIL_ARROW_HEIGHT = 0.52;
const TRAIL_ARROW_WIDTH = TRAIL_ARROW_HEIGHT * TRAIL_ARROW_ASPECT_RATIO;
/** World-space speed of the repeating player → mailbox arrow flow. */
const TRAIL_ARROW_TRAVEL_SPEED = 1.8;
/** Later days briefly remind the player of the mailbox route. */
const LATER_DAY_TRAIL_DURATION_SEC = 5;
const TRAIL_ARROW_TEXTURE_PATH = '@project/assets/textures/mail-trail-arrow.png';
const ENVELOPE_INSERT_SEC = 2.0;
/** Extra world-Y lift so the envelope meets the mailbox slot. */
const ENVELOPE_SLOT_Y_BOOST = 0.06;
/** Mailbox close-up: camera elevation above the floor plane (degrees). */
const MAILBOX_CINEMATIC_PITCH_FROM_FLOOR_DEG = 30;
const ORDINANCE_MODEL_PATH = /PolyforkAssets\/Ordinances\//i;
const MAIN_ROAD_NAME = /^MainRoad/i;
const LEFT_SIDE_ROAD_NAME = /^LeftSideRoad/i;
const RIGHT_SIDE_ROAD_NAME = /^RightSideRoad/i;
const TRAM_TRACK_NAME = /^Tram Track/i;
const CARGO_CRATE_NAME = /^Cargo Crate(?:\s|$)/i;
const PARK_BENCH_NAME = /^Park Bench(?:\s|$)/i;
/** Prefab drops from cherry trees — "Log" / "Log 2"… (not ordinance "Logs"). */
const CARRYABLE_LOG_NAME = /^Log(?:\s+\d+)?$/i;
const CARRYABLE_LOG_MODEL = /fallen-log/i;
/** Prefab drops from trail map kiosk — "Kiosk Wood" / "Kiosk Wood 2"… */
const KIOSK_WOOD_NAME = /^Kiosk Wood(?:\s+\d+)?$/i;
/** Scene board is named Kiosk (visual: Dont remove this kiosk). */
const DONT_REMOVE_THIS_KIOSK_NAME =
  /^(?:DontRemoveThisKiosk|Dont remove this kiosk|Kiosk)$/i;
const DONT_REMOVE_THIS_KIOSK_ANY_NAME =
  /^(?:DontRemoveThisKiosk|Dont remove this kiosk|Kiosk)(?:\s+\d+)?$/i;
const KIOSK_WOOD_MODEL = /(?:^|\/)Wood[12](?:-centered)?\.glb$/i;
/** Prefab drops from dismantled cargo crates — "Crate Planks Drop" / "Crate Planks Drop 2"… */
const CRATE_PLANKS_DROP_NAME = /^Crate Planks Drop(?:\s+\d+)?$/i;
const CRATE_PLANKS_DROP_MODEL = /crate_planks\.glb$/i;
/** Prefab scraps from street lamps / benches / guardrails. */
const METAL_SCRAPT_NAME = /^Metal Scrapt(?:\s+\d+)?$/i;
const BENCH_SCRAPT_NAME = /^Bench Scrapt(?:\s+\d+)?$/i;
/** Drops only — "Guardrail 1", not "Guardrail D" / "Guardrail Section". */
const GUARDRAIL_SCRAP_DROP_NAME = /^Guardrail(?:\s+\d+)?$/i;
const METAL_SCRAP_MODEL = /metal_scrapt|Bench_scrapt|guardrail[1-4]\.glb/i;
const CLIMB_CAR_NAME = /^Yellow Cab/i;
const CAR_ROOF_TRIGGER_NAME = /^CarRoofTrigger/i;
const CITY_TRAM_NAME = /^City Tram$/i;
/** Author-scaled MeshNode (preferred) or legacy auto SceneNode. */
const TRAM_TRIGGER_NAME = /^TramTrigger$/i;
const TRAM_ROOF_TRIGGER_NAME = /^TramRoofTrigger$/i;
const MAILBOX_NAME = /Mailbox/i;
const MAINTENANCE_NAME = /^Maintenance$/i;
const JAYWALKING_NAME = /^JayWalking$/i;
const JAYWALKING_ANY_NAME = /^JayWalking/i;
const DO_NOT_STEP_CAR_NAME = /^Do Not Step Car$/i;
const DO_NOT_STEP_CAR_ANY_NAME = /^Do Not Step Car/i;
const DO_NOT_STEP_CITY_TRAM_NAME = /^Do Not Step City Tram$/i;
const DO_NOT_STEP_CITY_TRAM_ANY_NAME = /^Do Not Step City Tram/i;
/** Author-scaled MeshNode on each Street Lamp top. */
const LAMP_TRIGGER_NAME = /^LampTrigger$/i;
const WIRE_TRIGGER_NAME = /^WireTrigger$/i;
const STREET_LIGHTS_CLIMB_NAME = /^Street Lights Climb$/i;
const STREET_LIGHTS_CLIMB_ANY_NAME = /^Street Lights Climb/i;
/** Scene boards are named Street Lights Destroy… (visual: Dont destroy the street lights). */
const STREET_LIGHTS_DESTROY_NAME =
  /^(?:DontDestroyTheStreetLights|Dont destroy the street lights|Street Lights Destroy)$/i;
const STREET_LIGHTS_DESTROY_ANY_NAME =
  /^(?:DontDestroyTheStreetLights|Dont destroy the street lights|Street Lights Destroy)(?:\s+\d+)?$/i;
/** Street-lamp scrap meshes used as road platforms (not bench/guardrail scrap). */
const STREET_LAMP_SCRAP_PLATFORM_NAME = /^Metal Scrapt(?:\s+\d+)?$/i;
/** Scene board is named Cat Feed (visual: Dont feed the cat). */
const DONT_FEED_THE_CAT_NAME =
  /^(?:DontFeedTheCat|Dont feed the cat|Cat Feed)$/i;
const DONT_FEED_THE_CAT_ANY_NAME =
  /^(?:DontFeedTheCat|Dont feed the cat|Cat Feed)(?:\s+\d+)?$/i;
/** Scene board is named Cats (visual: No cats on streets). */
const NO_CATS_ON_STREETS_NAME =
  /^(?:NoCatsOnStreets|No cats on streets|Cats)$/i;
const NO_CATS_ON_STREETS_ANY_NAME =
  /^(?:NoCatsOnStreets|No cats on streets|Cats)(?:\s+\d+)?$/i;
/** Scene boards are named Crates / Crates 02…; also accept "No Crates on Roads". */
const NO_CRATES_ON_ROADS_NAME = /^(?:No Crates on Roads|Crates)$/i;
const NO_CRATES_ON_ROADS_ANY_NAME = /^(?:No Crates on Roads|Crates)(?:\s|$)/i;
/** Scene boards are named Bench / Bench 02…; also accept "No Bench on Roads". */
const NO_BENCH_ON_ROADS_NAME = /^(?:No Bench on Roads|Bench)$/i;
const NO_BENCH_ON_ROADS_ANY_NAME = /^(?:No Bench on Roads|Bench)(?:\s+\d+)?$/i;
/** Scene boards are named Logs / Logs 02…; also accept "No Logs on Roads". */
const NO_LOGS_ON_ROADS_NAME = /^(?:No Logs on Roads|Logs)$/i;
const NO_LOGS_ON_ROADS_ANY_NAME = /^(?:No Logs on Roads|Logs)(?:\s+\d+)?$/i;
/** Scene boards are named Wood Planks / Wood Planks 02… */
const NO_WOOD_PLANKS_ON_ROADS_NAME = /^(?:No Wood Planks on Roads|Wood Planks)$/i;
const NO_WOOD_PLANKS_ON_ROADS_ANY_NAME = /^(?:No Wood Planks on Roads|Wood Planks)(?:\s+\d+)?$/i;
/** Scene boards are named Metals / Metals 02… */
const NO_SCRAP_METALS_ON_ROADS_NAME = /^(?:No Scrap Metals on Roads|Metals)$/i;
const NO_SCRAP_METALS_ON_ROADS_ANY_NAME = /^(?:No Scrap Metals on Roads|Metals)(?:\s+\d+)?$/i;
/** Scene board is named Bushes (visual: Dont remove this bush). */
const DONT_REMOVE_THIS_BUSH_NAME = /^(?:DontRemoveThisBush|Dont remove this bush|Bushes)$/i;
const DONT_REMOVE_THIS_BUSH_ANY_NAME = /^(?:DontRemoveThisBush|Dont remove this bush|Bushes)(?:\s+\d+)?$/i;
/** Scene boards are named Pole Cut / Pole Cut 02… (visual: Dont Cut this pole). */
const DONT_CUT_THIS_POLE_NAME = /^(?:DontCutThisPole|Dont Cut this pole|Pole Cut)$/i;
const DONT_CUT_THIS_POLE_ANY_NAME = /^(?:DontCutThisPole|Dont Cut this pole|Pole Cut)(?:\s+\d+)?$/i;
/** Scene board is named Shop Sign (visual: Dont Destroy this Sign). */
const DO_NOT_DESTROY_THIS_SIGN_NAME =
  /^(?:DontDestroyThisSign|Dont Destroy this Sign|Do not destroy this sign|Shop Sign)$/i;
const DO_NOT_DESTROY_THIS_SIGN_ANY_NAME =
  /^(?:DontDestroyThisSign|Dont Destroy this Sign|Do not destroy this sign|Shop Sign)(?:\s+\d+)?$/i;
/** Scene boards are named Fire Hydrant / Fire Hydrant 02… (visual: Dont hit the fire hydrant). */
const DONT_HIT_THE_FIRE_HYDRANT_NAME =
  /^(?:DontHitTheFireHydrant|Dont hit the fire hydrant|Fire Hydrant)$/i;
const DONT_HIT_THE_FIRE_HYDRANT_ANY_NAME =
  /^(?:DontHitTheFireHydrant|Dont hit the fire hydrant|Fire Hydrant)(?:\s+\d+)?$/i;
/** Scene boards are named High Voltage / High Voltage 02… (pole-mounted). */
const HIGH_VOLTAGE_NAME = /^High Voltage$/i;
const HIGH_VOLTAGE_ANY_NAME = /^High Voltage(?:\s+\d+)?$/i;
/** Author MeshNode on cherry canopy tops (scene spelling may be TreeTriggger). */
const TREE_TRIGGER_NAME = /^TreeTrigg+er(?:\s+\d+)?$/i;
/** Scene boards are named Trees Climbing… (visual: No climbing on the tree). */
const NO_CLIMBING_ON_THE_TREE_NAME =
  /^(?:NoClimbingOnTheTree|No climbing on the tree|Trees Climbing)$/i;
const NO_CLIMBING_ON_THE_TREE_ANY_NAME =
  /^(?:NoClimbingOnTheTree|No climbing on the tree|Trees Climbing)(?:\s+\d+)?$/i;
/** Scene boards are named Trees Cutting / Trees Cutting 02… (visual: No cutting of trees). */
const NO_CUTTING_OF_TREES_NAME =
  /^(?:NoCuttingOfTrees|No cutting of trees|Trees Cutting)$/i;
const NO_CUTTING_OF_TREES_ANY_NAME =
  /^(?:NoCuttingOfTrees|No cutting of trees|Trees Cutting)(?:\s+\d+)?$/i;
/** Scene board is named Signs (visual: Do not remove the SIGNS). */
const DO_NOT_REMOVE_THE_SIGNS_NAME =
  /^(?:DoNotRemoveTheSigns|Do not remove the SIGNS|Signs)$/i;
const DO_NOT_REMOVE_THE_SIGNS_ANY_NAME =
  /^(?:DoNotRemoveTheSigns|Do not remove the SIGNS|Signs)(?:\s+\d+)?$/i;
/**
 * Fallen ordinance-board prefab meshes used as road platforms.
 * e.g. "Maintenance Fallen Mesh", "Jay Walking Fallen Mesh".
 */
const FALLEN_ORDINANCE_SIGN_PLATFORM_NAME = / Fallen(?:\s+Mesh)?$/i;
const FALLEN_ORDINANCE_SIGN_MODEL_PATH = /PolyforkAssets\/Ordinances\//i;
/** Standing utility poles (not fallen prefab meshes). */
const STANDING_UTILITY_POLE_NAME = /^Utility Pole(?:\s+\d+)?$/i;
const KANJI_SIGN_PLATFORM_NAME = /^Kanji Sign(?:\s+\d+)?$/i;
/**
 * Dismantled utility-pole prefab meshes only — not standing Utility Pole 15/16/…
 * e.g. "Utility Pole Fallen Mesh", "Utility Pole 20 Fallen Mesh".
 */
const FALLEN_UTILITY_POLE_PLATFORM_NAME = /^Utility Pole(?:\s+\d+)? Fallen(?:\s+Mesh)?$/i;
const CONES_NAME = /^(?:Cones|OrdinanceCones)$/i;
const TRAFFIC_CONE_NAME = /^Traffic Cone C/i;
/** Standing/dismantle cones — exclude flat scrap drops. */
const TRAFFIC_CONE_PLATFORM_NAME = /^Traffic Cone C(?! flat(?:\s|$))(?:\s|$)/i;
/** Scene board for cone-platform / cone-dismantle ordinance. */
const DONT_REMOVE_THE_CONES_NAME = /^DontRemoveTheCones$/i;
const DONT_REMOVE_THE_CONES_ANY_NAME = /^DontRemoveTheCones/i;
const HIGHLIGHT_RED = new THREE.Color(0xe11d2e);
const HIGHLIGHT_EMISSIVE = new THREE.Color(0xff1a1a);
const OUTLINE_GREEN = new THREE.Color(0x39ff63);
const PLAYER_WAIT_FRAMES = 180;

enum FlowPhase {
  Boot = 'boot',
  IntroSpeech = 'introSpeech',
  ZoomOutReveal = 'zoomOutReveal',
  AwaitingDelivery = 'awaitingDelivery',
  DeliveryFocus = 'deliveryFocus',
  OrdinanceFocus = 'ordinanceFocus',
  FadeToBlack = 'fadeToBlack',
  HoldBlack = 'holdBlack',
  FadeFromBlack = 'fadeFromBlack',
  NextDayLabel = 'nextDayLabel',
  ZoomOutToPlay = 'zoomOutToPlay',
}

type HiddenOrdinance = {
  node: ENGINE.ModelMeshNode;
  /** Authored physics captured before the prop was hidden. */
  physicsOptions: ENGINE.NodePhysicsOptions;
  /** Traffic cones stay dynamic/carryable; sign boards stay static. */
  movable: boolean;
};

type DayTransformSnapshot = {
  node: ENGINE.SceneNode;
  localPosition: THREE.Vector3;
  localQuaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  /** Full authored physics snapshot; null for non-Primitive nodes. */
  physicsOptions: ENGINE.NodePhysicsOptions | null;
};

type PendingOrdinance =
  | 'maintenance'
  | 'jaywalking'
  | 'doNotStepCar'
  | 'doNotStepTram'
  | 'streetLightsClimb'
  | 'dontDestroyTheStreetLights'
  | 'dontFeedTheCat'
  | 'noCatsOnStreets'
  | 'noCratesOnRoads'
  | 'noBenchOnRoads'
  | 'noLogsOnRoads'
  | 'noWoodPlanksOnRoads'
  | 'dontRemoveTheCones'
  | 'noScrapMetalsOnRoads'
  | 'dontRemoveThisBush'
  | 'dontRemoveThisKiosk'
  | 'dontCutThisPole'
  | 'doNotDestroyThisSign'
  | 'dontHitTheFireHydrant'
  | 'highVoltage'
  | 'noClimbingOnTheTree'
  | 'noCuttingOfTrees'
  | 'doNotRemoveTheSigns';

/** Ordinances unlocked by how mail was successfully delivered (not first-touch). */
type DeliveryRouteCandidate =
  | 'noCatsOnStreets'
  | 'dontFeedTheCat'
  | 'noCuttingOfTrees'
  | 'dontRemoveThisKiosk'
  | 'noClimbingOnTheTree'
  | 'dontCutThisPole'
  | 'doNotDestroyThisSign'
  | 'doNotRemoveTheSigns'
  | 'dontDestroyTheStreetLights'
  | 'dontRemoveTheCones'
  | 'streetLightsClimb'
  | 'highVoltage'
  | 'doNotStepTram'
  | 'doNotStepCar';

type MailDeliveryVia = 'mailboxClick' | 'catUnfed' | 'catPeach';

type MailboxPulseRecord = {
  mesh: THREE.Mesh;
  originalMaterial: THREE.Material | THREE.Material[];
  pulseMaterial: THREE.Material | THREE.Material[];
};

type RoadHighlightKind = 'mainRoad' | 'leftSideRoad';

@ENGINE.GameClass()
export class MailDeliveryFlowSystem extends ENGINE.SceneNode {
  private phase: FlowPhase = FlowPhase.Boot;
  private phaseElapsed = 0;
  private player: ThirdPersonPlayer | null = null;
  private mailbox: ENGINE.ModelMeshNode | null = null;
  private maintenance: ENGINE.ModelMeshNode | null = null;
  private jaywalking: ENGINE.ModelMeshNode | null = null;
  private doNotStepCar: ENGINE.ModelMeshNode | null = null;
  private doNotStepCityTram: ENGINE.ModelMeshNode | null = null;
  private streetLightsClimb: ENGINE.ModelMeshNode | null = null;
  private readonly streetLightsClimbOrdinances: ENGINE.ModelMeshNode[] = [];
  private streetLightsDestroy: ENGINE.ModelMeshNode | null = null;
  private readonly streetLightsDestroyOrdinances: ENGINE.ModelMeshNode[] = [];
  private dontFeedTheCat: ENGINE.ModelMeshNode | null = null;
  private readonly dontFeedTheCatOrdinances: ENGINE.ModelMeshNode[] = [];
  private noCatsOnStreets: ENGINE.ModelMeshNode | null = null;
  private readonly noCatsOnStreetsOrdinances: ENGINE.ModelMeshNode[] = [];
  private noCratesOnRoads: ENGINE.ModelMeshNode | null = null;
  private readonly noCratesOnRoadsOrdinances: ENGINE.ModelMeshNode[] = [];
  private noBenchOnRoads: ENGINE.ModelMeshNode | null = null;
  private readonly noBenchOnRoadsOrdinances: ENGINE.ModelMeshNode[] = [];
  private noLogsOnRoads: ENGINE.ModelMeshNode | null = null;
  private readonly noLogsOnRoadsOrdinances: ENGINE.ModelMeshNode[] = [];
  private noWoodPlanksOnRoads: ENGINE.ModelMeshNode | null = null;
  private readonly noWoodPlanksOnRoadsOrdinances: ENGINE.ModelMeshNode[] = [];
  private dontRemoveTheCones: ENGINE.ModelMeshNode | null = null;
  private readonly dontRemoveTheConesOrdinances: ENGINE.ModelMeshNode[] = [];
  private noScrapMetalsOnRoads: ENGINE.ModelMeshNode | null = null;
  private readonly noScrapMetalsOnRoadsOrdinances: ENGINE.ModelMeshNode[] = [];
  private dontRemoveThisBush: ENGINE.ModelMeshNode | null = null;
  private readonly dontRemoveThisBushOrdinances: ENGINE.ModelMeshNode[] = [];
  private dontRemoveThisKiosk: ENGINE.ModelMeshNode | null = null;
  private readonly dontRemoveThisKioskOrdinances: ENGINE.ModelMeshNode[] = [];
  private dontCutThisPole: ENGINE.ModelMeshNode | null = null;
  private readonly dontCutThisPoleOrdinances: ENGINE.ModelMeshNode[] = [];
  private doNotDestroyThisSign: ENGINE.ModelMeshNode | null = null;
  private readonly doNotDestroyThisSignOrdinances: ENGINE.ModelMeshNode[] = [];
  private dontHitTheFireHydrant: ENGINE.ModelMeshNode | null = null;
  private readonly dontHitTheFireHydrantOrdinances: ENGINE.ModelMeshNode[] = [];
  private highVoltage: ENGINE.ModelMeshNode | null = null;
  private readonly highVoltageOrdinances: ENGINE.ModelMeshNode[] = [];
  private noCuttingOfTrees: ENGINE.ModelMeshNode | null = null;
  private readonly noCuttingOfTreesOrdinances: ENGINE.ModelMeshNode[] = [];
  private noClimbingOnTheTree: ENGINE.ModelMeshNode | null = null;
  private readonly noClimbingOnTheTreeOrdinances: ENGINE.ModelMeshNode[] = [];
  private doNotRemoveTheSigns: ENGINE.ModelMeshNode | null = null;
  private readonly doNotRemoveTheSignsOrdinances: ENGINE.ModelMeshNode[] = [];
  private cones: ENGINE.ModelMeshNode | null = null;
  private readonly trafficCones: ENGINE.ModelMeshNode[] = [];
  /** Live Traffic Cone C props used for platform detection (not ordinance boards). */
  private readonly platformTrafficCones: ENGINE.ModelMeshNode[] = [];
  /** Spawned fallen utility-pole meshes used as road platforms (not standing poles). */
  private readonly platformFallenUtilityPoles: ENGINE.ModelMeshNode[] = [];
  /** Spawned fallen ordinance-board meshes used as road platforms. */
  private readonly platformFallenOrdinanceSigns: ENGINE.ModelMeshNode[] = [];
  /** Street-lamp Metal Scrapt pieces used as road platforms. */
  private readonly platformStreetLampScraps: ENGINE.ModelMeshNode[] = [];
  private readonly mainRoadNodes: ENGINE.SceneNode[] = [];
  private readonly leftSideRoadNodes: ENGINE.SceneNode[] = [];
  private readonly rightSideRoadNodes: ENGINE.SceneNode[] = [];
  private readonly tramTrackNodes: ENGINE.SceneNode[] = [];
  private readonly climbCars: ENGINE.ModelMeshNode[] = [];
  private readonly carRoofTriggers: ENGINE.SceneNode[] = [];
  private readonly cityTrams: ENGINE.ModelMeshNode[] = [];
  private readonly tramRoofTriggers: ENGINE.SceneNode[] = [];
  private readonly lampTriggers: ENGINE.SceneNode[] = [];
  private readonly treeTriggers: ENGINE.SceneNode[] = [];
  private readonly wireTriggers: ENGINE.SceneNode[] = [];
  private readonly standingUtilityPoles: ENGINE.ModelMeshNode[] = [];
  private readonly kanjiSignPlatforms: ENGINE.ModelMeshNode[] = [];
  /**
   * First new ordinance broken this day.
   * Only one new ordinance can be queued per day.
   */
  private pendingOrdinance: PendingOrdinance | null = null;
  /** Maintenance board + cones are already in the world. */
  private maintenanceOrdinanceActive = false;
  /** JayWalking board(s) are already in the world. */
  private jaywalkingOrdinanceActive = false;
  /** Do Not Step Car board is already in the world. */
  private doNotStepCarOrdinanceActive = false;
  /** Do Not Step City Tram board is already in the world. */
  private doNotStepTramOrdinanceActive = false;
  /** Street Lights Climb board(s) are already in the world. */
  private streetLightsClimbOrdinanceActive = false;
  /** Dont destroy the street lights board(s) are already in the world. */
  private dontDestroyTheStreetLightsOrdinanceActive = false;
  /** Dont feed the cat board(s) are already in the world. */
  private dontFeedTheCatOrdinanceActive = false;
  /** No cats on streets board(s) are already in the world. */
  private noCatsOnStreetsOrdinanceActive = false;
  /** No Crates on Roads board(s) are already in the world. */
  private noCratesOnRoadsOrdinanceActive = false;
  /** No Bench on Roads board(s) are already in the world. */
  private noBenchOnRoadsOrdinanceActive = false;
  /** No Logs on Roads board(s) are already in the world. */
  private noLogsOnRoadsOrdinanceActive = false;
  /** No Wood Planks on Roads board(s) are already in the world. */
  private noWoodPlanksOnRoadsOrdinanceActive = false;
  /** DontRemoveTheCones board(s) are already in the world. */
  private dontRemoveTheConesOrdinanceActive = false;
  /** No Scrap Metals on Roads board(s) are already in the world. */
  private noScrapMetalsOnRoadsOrdinanceActive = false;
  /** DontRemoveThisBush board(s) are already in the world. */
  private dontRemoveThisBushOrdinanceActive = false;
  /** Dont remove this kiosk board(s) are already in the world. */
  private dontRemoveThisKioskOrdinanceActive = false;
  /** DontCutThisPole board(s) are already in the world. */
  private dontCutThisPoleOrdinanceActive = false;
  /** Do not destroy this sign board(s) are already in the world. */
  private doNotDestroyThisSignOrdinanceActive = false;
  /** Dont hit the fire hydrant board(s) are already in the world. */
  private dontHitTheFireHydrantOrdinanceActive = false;
  /** High Voltage board(s) are already in the world. */
  private highVoltageOrdinanceActive = false;
  /** No cutting of trees board(s) are already in the world. */
  private noCuttingOfTreesOrdinanceActive = false;
  /** No climbing on the tree board(s) are already in the world. */
  private noClimbingOnTheTreeOrdinanceActive = false;
  /** Do not remove the SIGNS board(s) are already in the world. */
  private doNotRemoveTheSignsOrdinanceActive = false;
  /** After wake, focus the newly revealed Maintenance ordinance once. */
  private focusOrdinanceOnWake = false;
  /** After wake, focus the newly revealed JayWalking ordinance once. */
  private focusJaywalkingOnWake = false;
  /** After wake, focus the newly revealed Do Not Step Car ordinance once. */
  private focusDoNotStepCarOnWake = false;
  /** After wake, focus the newly revealed Do Not Step City Tram ordinance once. */
  private focusDoNotStepTramOnWake = false;
  /** After wake, focus the newly revealed Street Lights Climb ordinance once. */
  private focusStreetLightsClimbOnWake = false;
  /** After wake, focus the newly revealed Dont destroy the street lights ordinance once. */
  private focusDontDestroyTheStreetLightsOnWake = false;
  /** After wake, focus the newly revealed Dont feed the cat ordinance once. */
  private focusDontFeedTheCatOnWake = false;
  /** After wake, focus the newly revealed No cats on streets ordinance once. */
  private focusNoCatsOnStreetsOnWake = false;
  /** After wake, focus the newly revealed No Crates on Roads ordinance once. */
  private focusNoCratesOnRoadsOnWake = false;
  /** After wake, focus the newly revealed No Bench on Roads ordinance once. */
  private focusNoBenchOnRoadsOnWake = false;
  /** After wake, focus the newly revealed No Logs on Roads ordinance once. */
  private focusNoLogsOnRoadsOnWake = false;
  /** After wake, focus the newly revealed No Wood Planks on Roads ordinance once. */
  private focusNoWoodPlanksOnRoadsOnWake = false;
  /** After wake, focus the newly revealed DontRemoveTheCones ordinance once. */
  private focusDontRemoveTheConesOnWake = false;
  /** After wake, focus the newly revealed No Scrap Metals on Roads ordinance once. */
  private focusNoScrapMetalsOnRoadsOnWake = false;
  /** After wake, focus the newly revealed DontRemoveThisBush ordinance once. */
  private focusDontRemoveThisBushOnWake = false;
  /** After wake, focus the newly revealed Dont remove this kiosk ordinance once. */
  private focusDontRemoveThisKioskOnWake = false;
  /** After wake, focus the newly revealed DontCutThisPole ordinance once. */
  private focusDontCutThisPoleOnWake = false;
  /** After wake, focus the newly revealed Do not destroy this sign ordinance once. */
  private focusDoNotDestroyThisSignOnWake = false;
  /** After wake, focus the newly revealed Dont hit the fire hydrant ordinance once. */
  private focusDontHitTheFireHydrantOnWake = false;
  /** After wake, focus the newly revealed High Voltage ordinance once. */
  private focusHighVoltageOnWake = false;
  /** After wake, focus the newly revealed No cutting of trees ordinance once. */
  private focusNoCuttingOfTreesOnWake = false;
  /** After wake, focus the newly revealed No climbing on the tree ordinance once. */
  private focusNoClimbingOnTheTreeOnWake = false;
  /** After wake, focus the newly revealed Do not remove the SIGNS ordinance once. */
  private focusDoNotRemoveTheSignsOnWake = false;
  /** World position where the player last climbed a lamp (for nearest-board focus). */
  private readonly lampClimbFocusAnchor = new THREE.Vector3();
  private hasLampClimbFocusAnchor = false;
  private readonly treeClimbFocusAnchor = new THREE.Vector3();
  private hasTreeClimbFocusAnchor = false;
  /**
   * Delivery-route candidates marked during the day. Resolved on successful mail delivery
   * (last enabling stamp wins; static priority on ties). Family A violations still set
   * pendingOrdinance immediately.
   */
  private readonly routeCandidates = new Set<DeliveryRouteCandidate>();
  private routeCandidateStamp = 0;
  private readonly routeCandidateAt = new Map<DeliveryRouteCandidate, number>();
  private deliveryVia: MailDeliveryVia | null = null;
  /** Carryable tree logs that have rested on a restricted road/track. */
  private readonly logsThatTouchedRoad = new WeakSet<ENGINE.ModelMeshNode>();
  /** Kiosk wood pieces that have rested on a restricted road/track. */
  private readonly kioskWoodThatTouchedRoad = new WeakSet<ENGINE.ModelMeshNode>();
  /** World position of the cargo crate that last violated a road/track. */
  private readonly noCratesFocusAnchor = new THREE.Vector3();
  private hasNoCratesFocusAnchor = false;
  /** World position of the park bench that last violated a road/track. */
  private readonly noBenchFocusAnchor = new THREE.Vector3();
  private hasNoBenchFocusAnchor = false;
  /** World position of the log that last violated a road/track. */
  private readonly noLogsFocusAnchor = new THREE.Vector3();
  private hasNoLogsFocusAnchor = false;
  /** World position of the kiosk wood that last violated a road/track. */
  private readonly noWoodPlanksFocusAnchor = new THREE.Vector3();
  private hasNoWoodPlanksFocusAnchor = false;
  /** World position of the metal scrap that last violated a road/track. */
  private readonly noScrapMetalsFocusAnchor = new THREE.Vector3();
  private hasNoScrapMetalsFocusAnchor = false;
  /** After ordinance focus, continue into the black next-day transition. */
  private fadeAfterOrdinanceFocus = false;
  /** Staged next-day transition under black (scrap hide → destroy → restore → reveal). */
  private dayTransitionScrapRetired = false;
  private dayTransitionWorldRestored = false;
  private dayTransitionWorldRestoreStarted = false;
  private dayTransitionWorldRestoreCursor = 0;
  private dayTransitionWorldRestoredAt = 0;
  private dayTransitionOrdinanceRevealed = false;
  private dayTransitionOrdinanceRevealedAt = 0;
  private dayTransitionCamReady = false;
  private hiddenOrdinances: HiddenOrdinance[] = [];
  private speechEl: HTMLDivElement | null = null;
  private fadeEl: HTMLDivElement | null = null;
  private nextDayEl: HTMLDivElement | null = null;
  private trailGroup: THREE.Group | null = null;
  private readonly trailArrows: THREE.Mesh[] = [];
  private trailArrowTexture: THREE.Texture | null = null;
  private trailArrowMaterial: THREE.MeshBasicMaterial | null = null;
  /** Infinity on day one; later days count down to hide the route hint. */
  private trailVisibleRemaining = 0;
  private readonly mailboxPulseRecords: MailboxPulseRecord[] = [];
  private mailboxHighlightActive = false;
  /** After the first reveal, pulse the matching road while the camera returns to play. */
  private pendingRoadHighlight: RoadHighlightKind | null = null;
  private readonly roadHighlightPulseRecords: MailboxPulseRecord[] = [];
  private roadHighlightActive = false;
  private roadHighlightElapsed = 0;
  private readonly roadHighlightTint = new THREE.Color();
  private readonly tmpPlayerPos = new THREE.Vector3();
  private readonly tmpMailboxPos = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpNdc = new THREE.Vector2();
  private readonly tmpProjected = new THREE.Vector3();
  private readonly raycaster = new THREE.Raycaster();
  private readonly upAxis = new THREE.Vector3(0, 1, 0);
  private pulseTime = 0;
  private introSpeechText = 'I need to deliver this mail';
  private outlineReady = false;
  private mailboxHovered = false;
  private playableGraceRemaining = 0;
  private mainRoadLoopTriggered = false;
  private leftSideRoadLoopTriggered = false;
  private carRoofLoopTriggered = false;
  private tramRoofLoopTriggered = false;
  private lampClimbLoopTriggered = false;
  private dontDestroyTheStreetLightsLoopTriggered = false;
  private dontFeedTheCatLoopTriggered = false;
  private noCatsOnStreetsLoopTriggered = false;
  private noCratesOnRoadsLoopTriggered = false;
  private noBenchOnRoadsLoopTriggered = false;
  private noLogsOnRoadsLoopTriggered = false;
  private noWoodPlanksOnRoadsLoopTriggered = false;
  private dontRemoveTheConesLoopTriggered = false;
  private noScrapMetalsOnRoadsLoopTriggered = false;
  private dontRemoveThisBushLoopTriggered = false;
  private dontRemoveThisKioskLoopTriggered = false;
  private dontCutThisPoleLoopTriggered = false;
  private doNotDestroyThisSignLoopTriggered = false;
  private dontHitTheFireHydrantLoopTriggered = false;
  private highVoltageLoopTriggered = false;
  private noCuttingOfTreesLoopTriggered = false;
  private noClimbingOnTheTreeLoopTriggered = false;
  private doNotRemoveTheSignsLoopTriggered = false;
  /** Time spent carrying a cone before soft-looping DontRemoveTheCones. */
  private conePickupCarryElapsed = 0;
  /** Time spent wearing a bush before soft-looping DontRemoveThisBush. */
  private bushWearCarryElapsed = 0;
  /** Countdown after a pole cut before soft-looping DontCutThisPole (lets fall finish). */
  private poleCutSoftLoopDelayRemaining = 0;
  /** Countdown after kanji fall before soft-looping Do not destroy this sign. */
  private kanjiSignSoftLoopDelayRemaining = 0;
  /** Countdown after hydrant spray starts before soft-looping Dont hit the fire hydrant. */
  private fireHydrantSoftLoopDelayRemaining = 0;
  /** Countdown after a tree is cut before soft-looping No cutting of trees. */
  private treeCutSoftLoopDelayRemaining = 0;
  /** Countdown after a trail map kiosk is dismantled before soft-looping Dont remove this kiosk. */
  private kioskDismantleSoftLoopDelayRemaining = 0;
  /** Countdown after a sign board falls before soft-looping Do not remove the SIGNS. */
  private signsSoftLoopDelayRemaining = 0;
  /** Countdown after a street lamp scrap appears before soft-looping Dont destroy the street lights. */
  private streetLampDestroySoftLoopDelayRemaining = 0;
  /** Hold time after the ordinance cinematic has settled (not during inbound blend). */
  private ordinanceFocusHoldElapsed = 0;
  private readonly tmpBounds = new THREE.Box3();
  private readonly tmpHead = new THREE.Vector3();
  private readonly tmpHitPoint = new THREE.Vector3();
  private readonly tmpFeetLocal = new THREE.Vector3();
  private readonly tmpRoadWorldPos = new THREE.Vector3();
  private readonly tmpForward = new THREE.Vector3();
  private readonly tmpQuat = new THREE.Quaternion();
  private readonly tmpParentQuat = new THREE.Quaternion();
  private readonly tmpMatrix = new THREE.Matrix4();
  private readonly tmpWorldScale = new THREE.Vector3();
  private readonly cinematicStartPos = new THREE.Vector3();
  private readonly cinematicEndPos = new THREE.Vector3();
  private readonly cinematicLookAt = new THREE.Vector3();
  private readonly cinematicStartQuat = new THREE.Quaternion();
  private readonly cinematicEndQuat = new THREE.Quaternion();
  private viewTargetCam: ENGINE.ViewTargetCameraNode | null = null;
  private cinematicActive = false;
  private cinematicBlend = 0;
  /** When true, cinematic blends toward the player orbit cam instead of a model. */
  private cinematicReturningToPlayer = false;
  private cinematicReturnDistance = DEFAULT_CAMERA_DISTANCE;
  private envelopeMesh: THREE.Mesh | null = null;
  private readonly envelopeStartPos = new THREE.Vector3();
  private readonly envelopeEndPos = new THREE.Vector3();
  private readonly envelopeQuat = new THREE.Quaternion();
  private envelopeProgress = 0;
  private envelopeStarted = false;
  private envelopeFinishedElapsed = 0;
  private introZoomElapsed = 0;
  /** Immutable session baseline (authored transforms) — never overwritten after first capture. */
  private readonly daySnapshots: DayTransformSnapshot[] = [];
  private readonly dayBaselineIds = new Set<string>();
  private sessionBaselineCaptured = false;
  private readonly catMailCourier = new CatMailCourier({
    getPlayer: () => this.player,
    getMailbox: () => this.mailbox,
    isDeliveryPhase: () => (
      this.phase === FlowPhase.AwaitingDelivery
      || this.phase === FlowPhase.ZoomOutReveal
      || this.phase === FlowPhase.IntroSpeech
    ),
    onCatReachedPeach: () => this.onCatReachedPeach(),
    onCatDeliveredMail: (via) => {
      this.deliveryVia = via === 'unfed' ? 'catUnfed' : 'catPeach';
      this.resolvePendingOrdinanceForSuccessfulDelivery();
      this.completeDelivery();
    },
    onCatClickedUnfed: () => this.onCatClickedUnfed(),
  });
  /** Re-apply baseline transforms for a few frames so physics can't snap props back. */
  private baselineReinforceRemaining = 0;
  private readonly tmpRestorePos = new THREE.Vector3();
  private readonly tmpRestoreQuat = new THREE.Quaternion();
  /**
   * Mesh is 4×4 local (−2..2). Nodes are scaled ×2 → 8×8 m world tiles.
   * worldToLocal already undoes scale, so half-extent stays in mesh units.
   */
  private readonly mainRoadHalfExtent = 1.95;
  /**
   * CharacterPawn root is the capsule *center*, not the feet.
   * Engine CHARACTER_HEIGHT is 1.8 → feet are 0.9 m below getWorldPosition().
   */
  private readonly pawnFeetBelowRoot = 0.9;
  /**
   * Crate/bench/log must actually rest on asphalt — bottom of the AABB.
   * Tight vertical contact; mid-air throws are ignored via vertical speed.
   */
  private readonly crateRoadContactYSlop = 0.1;
  /** Ignore props still in a throw arc (vertical only — sliding on the road still counts). */
  private readonly propRoadMaxVerticalSpeed = 1.75;
  /**
   * Bottom-Y samples for throw-arc rejection. Prefer this over Rapier linvel —
   * getPhysicsVectorParam during polls can trip WASM "unsafe aliasing" / unreachable.
   */
  private readonly propPrevBottomY = new Map<string, number>();
  private lastPrePhysicsDeltaTime = 1 / 60;
  /** Standing on a cone tip: allow feet slightly above the cone AABB top. */
  private readonly conePlatformTopYPad = 0.35;
  /** Standing on a fallen pole: allow feet slightly above the pole AABB top. */
  private readonly fallenPolePlatformTopYPad = 0.45;
  /** Standing on a fallen ordinance board: allow feet slightly above the AABB top. */
  private readonly fallenOrdinanceSignPlatformTopYPad = 0.4;
  /** Standing on street-lamp Metal Scrapt: allow feet slightly above the scrap AABB top. */
  private readonly streetLampScrapPlatformTopYPad = 0.4;
  /** Standing on kanji / pole crossarms: allow feet slightly above the AABB top. */
  /** Standing on Kiosk Wood (trail map parts) as a platform. */
  private readonly kioskWoodPlatformTopYPad = 0.4;
  private readonly elevatedPlatformTopYPad = 0.35;
  /** Upper fraction of a standing utility pole treated as wire/crossarm walkable. */
  private readonly utilityPoleWireHeightFrac = 0.55;
  /** Let the player hold a carried cone briefly before soft-looping DontRemoveTheCones. */
  private readonly conePickupSoftLoopDelaySec = 1.15;
  /** Let the player wear a bush briefly before soft-looping DontRemoveThisBush. */
  private readonly bushWearSoftLoopDelaySec = 1.15;
  /** After a pole finishes falling, wait briefly before soft-looping DontCutThisPole. */
  private readonly poleCutSoftLoopDelaySec = 2;
  /** Match kanji pose-fall (~2.2s) so the soft-loop waits until the sign has landed. */
  private readonly kanjiSignSoftLoopDelaySec = 2.25;
  /** Let hydrant water spray briefly before soft-looping Dont hit the fire hydrant. */
  private readonly fireHydrantSoftLoopDelaySec = 1;
  /** Let tree log drops appear briefly before soft-looping No cutting of trees. */
  private readonly treeCutSoftLoopDelaySec = 1.25;
  /** Let kiosk wood parts appear briefly before soft-looping Dont remove this kiosk. */
  private readonly kioskDismantleSoftLoopDelaySec = 1.25;
  /** Let an ordinance board tip/fall before soft-looping Do not remove the SIGNS. */
  private readonly signsSoftLoopDelaySec = 1.75;
  /** Let street-lamp scrap appear before soft-looping Dont destroy the street lights. */
  private readonly streetLampDestroySoftLoopDelaySec = 1.5;
  /** World-space vertical tolerance around the asphalt surface once feet are sampled. */
  private readonly mainRoadFeetWorldYSlop = 0.05;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: object): void {
    super.initialize({
      name: 'Mail Delivery Flow',
      ...options,
    });
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    void this.startFlow();
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.stopModelFrontCinematic();
    this.clearEnvelope();
    this.player?.setMailEnvelopeCarried(false);
    this.teardownUi();
    this.clearTrail();
    this.setMailboxHighlight(false);
    this.clearRoadHighlight();
    this.setMailboxHoverOutline(false);
    // Restore authored edit-mode visibility so ordinance boards stay visible in the editor.
    this.restoreOrdinanceVisibilityForEditMode();
    this.catMailCourier.dispose();
    if (this.player) {
      this.player.setMailDeliveryClickHandler(null);
      this.player.setTrafficConeFifthHitHandler(null);
      this.player.setUtilityPoleDismantledHandler(null);
      this.player.setKanjiSignDismantledHandler(null);
      this.player.setFireHydrantActivatedHandler(null);
      this.player.setCherryTreeDismantledHandler(null);
      this.player.setTrailMapKioskDismantledHandler(null);
      this.player.setOrdinanceBoardDismantledHandler(null);
      this.player.setStreetLampDismantledHandler(null);
      this.player.setMovementFrozen(false);
      this.player.setCinematicCameraLock(false);
    }
    return true;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this.lastPrePhysicsDeltaTime = Math.max(deltaTime, 1e-5);
    if (this.phase === FlowPhase.Boot) {
      return;
    }

    const world = this.getWorld();
    if (world && !this.speechEl) {
      this.ensureUi(world);
      if (this.phase === FlowPhase.IntroSpeech) {
        this.showSpeechBubble(this.introSpeechText);
      }
    }

    this.phaseElapsed += deltaTime;
    this.pulseTime += deltaTime;
    if (this.playableGraceRemaining > 0) {
      this.playableGraceRemaining = Math.max(0, this.playableGraceRemaining - deltaTime);
    }
    this.pollMainRoadFeetContact();
    this.pollLeftSideRoadFeetContact();
    this.pollCarRoofFeetContact();
    this.pollTramRoofFeetContact();
    this.pollLampClimbFeetContact();
    this.pollTreeClimbFeetContact();
    this.pollKioskWoodPlatformUse();
    this.pollWireWalkFeetContact();
    this.pollCargoCrateOnRoadContact();
    this.pollParkBenchOnRoadContact();
    this.pollLogOnRoadContact();
    this.pollWoodPlanksPropOnRoadContact();
    this.pollScrapMetalOnRoadContact();
    this.pollBushWearOnRoadContact();
    this.pollConePlatformRoadBypass();
    this.pollFallenPolePlatformRoadBypass();
    this.pollFallenOrdinanceSignPlatformRoadBypass();
    this.pollStreetLampScrapPlatformRoadBypass();
    this.pollTrafficConePickupSoftLoop(deltaTime);
    this.pollBushWearSoftLoop(deltaTime);
    this.pollPoleCutSoftLoop(deltaTime);
    this.pollKanjiSignSoftLoop(deltaTime);
    this.pollFireHydrantSoftLoop(deltaTime);
    this.pollTreeCutSoftLoop(deltaTime);
    this.pollKioskDismantleSoftLoop(deltaTime);
    this.pollSignsSoftLoop(deltaTime);
    this.pollStreetLampDestroySoftLoop(deltaTime);
    this.catMailCourier.tick(deltaTime);
    this.updateModelFrontCinematic(deltaTime);
    this.updateEnvelopeInsert(deltaTime);
    this.updateSpeechBubblePosition();
    this.updateTrail();
    this.updateTrailVisibility(deltaTime);
    this.updateMailboxPulse();
    this.updateRoadHighlightPulse(deltaTime);
    this.tickPhase(deltaTime);
  }

  public override tickPostPhysics(_deltaTime: number): void {
    super.tickPostPhysics(_deltaTime);
    if (this.baselineReinforceRemaining > 0) {
      const finalizePhysics = this.baselineReinforceRemaining === 1;
      // Static scenery was restored once under black. Only dynamic props need repeated
      // physics settling; replaying the entire scene here overloads the renderer/physics bridge.
      this.applyAllSnapshotPoses({ finalizePhysics, dynamicOnly: true });
      this.baselineReinforceRemaining -= 1;
      if (finalizePhysics) {
        this.reapplyOrdinanceVisibility();
      }
    }
    if (this.phase === FlowPhase.AwaitingDelivery || this.phase === FlowPhase.ZoomOutReveal) {
      this.updateMailboxHoverOutline();
      this.catMailCourier.tickHoverOutline();
    }
  }

  private async startFlow(): Promise<void> {
    const world = this.getWorld();
    if (!world) {
      return;
    }

    const controller = await world.gameMode?.waitForLocalPlayerController();
    this.player = await this.waitForPlayer(world, controller ?? null);
    this.player?.setMailEnvelopeCarried(true);
    this.mailbox = this.findModelByName(MAILBOX_NAME);
    this.maintenance = this.findModelByName(MAINTENANCE_NAME);
    this.jaywalking = this.findModelByName(JAYWALKING_NAME);
    this.doNotStepCar = this.findModelByName(DO_NOT_STEP_CAR_NAME);
    this.doNotStepCityTram = this.findModelByName(DO_NOT_STEP_CITY_TRAM_NAME);
    this.cones = this.findModelByName(CONES_NAME);
    this.cacheTrafficCones();
    this.cacheMainRoads();
    this.cacheLeftSideRoads();
    this.cacheRightSideRoads();
    this.cacheTramTracks();
    this.cacheClimbCarsAndRoofTriggers();
    this.cacheCityTramsAndRoofTriggers();
    this.cacheLampTriggers();
    this.cacheTreeTriggers();
    this.cacheWireTriggers();
    this.cacheStandingUtilityPoles();
    this.cacheKanjiSignPlatforms();
    this.cacheStreetLightsClimbOrdinances();
    this.cacheStreetLightsDestroyOrdinances();
    this.cacheDontFeedTheCatOrdinances();
    this.cacheNoCatsOnStreetsOrdinances();
    this.cacheNoCratesOnRoadsOrdinances();
    this.cacheNoBenchOnRoadsOrdinances();
    this.cacheNoLogsOnRoadsOrdinances();
    this.cacheNoWoodPlanksOnRoadsOrdinances();
    this.cacheDontRemoveTheConesOrdinances();
    this.cacheNoScrapMetalsOnRoadsOrdinances();
    this.cacheDontRemoveThisBushOrdinances();
    this.cacheDontRemoveThisKioskOrdinances();
    this.cacheDontCutThisPoleOrdinances();
    this.cacheDoNotDestroyThisSignOrdinances();
    this.cacheDontHitTheFireHydrantOrdinances();
    this.cacheHighVoltageOrdinances();
    this.cacheNoCuttingOfTreesOrdinances();
    this.cacheNoClimbingOnTheTreeOrdinances();
    this.cacheDoNotRemoveTheSignsOrdinances();
    this.cachePlatformTrafficCones();
    this.cachePlatformFallenUtilityPoles();

    this.hideInitialOrdinanceProps();
    this.catMailCourier.initialize(world);
    this.captureSessionBaseline();
    this.ensureGreenOutline(world);
    this.ensureUi(world);
    await this.buildTrail(world);

    if (this.player) {
      this.player.setMailDeliveryClickHandler(() => this.tryDeliverByClick());
      this.player.setTrafficConeFifthHitHandler(() => this.onTrafficConeFifthHit());
      this.player.setUtilityPoleDismantledHandler(() => this.onUtilityPoleDismantled());
      this.player.setKanjiSignDismantledHandler(() => this.onKanjiSignDismantled());
      this.player.setFireHydrantActivatedHandler(() => this.onFireHydrantActivated());
      this.player.setCherryTreeDismantledHandler(() => this.onCherryTreeDismantled());
      this.player.setTrailMapKioskDismantledHandler(() => this.onTrailMapKioskDismantled());
      this.player.setOrdinanceBoardDismantledHandler(() => this.onOrdinanceBoardDismantled());
      this.player.setStreetLampDismantledHandler(() => this.onStreetLampDismantled());
      this.player.setCinematicCameraLock(true);
      this.player.setCameraTargetDistance(INTRO_CAMERA_DISTANCE, true);
    }

    this.beginIntroSpeech();
  }

  private async waitForPlayer(
    world: ENGINE.World,
    controller: ENGINE.PlayerController | null,
  ): Promise<ThirdPersonPlayer | null> {
    for (let i = 0; i < PLAYER_WAIT_FRAMES; i += 1) {
      const fromController = controller?.getPawn();
      const pawn = (fromController instanceof ThirdPersonPlayer
        ? fromController
        : null)
        ?? world.getNodes(ThirdPersonPlayer)[0]
        ?? null;
      if (pawn?.getGameplayCamera()) {
        return pawn;
      }
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
    }
    return world.getNodes(ThirdPersonPlayer)[0] ?? null;
  }

  private tickPhase(_deltaTime: number): void {
    switch (this.phase) {
      case FlowPhase.IntroSpeech:
        this.player?.setCameraTargetDistance(INTRO_CAMERA_DISTANCE);
        if (this.phaseElapsed >= SPEECH_DURATION_SEC) {
          this.hideSpeechBubble();
          this.introZoomElapsed = 0;
          this.setMailboxHighlight(true);
          this.setTrailVisible(true);
          this.setPhase(FlowPhase.ZoomOutReveal);
        }
        break;
      case FlowPhase.ZoomOutReveal: {
        // Respect player movement: stop the tutorial zoom at its current view
        // rather than continuing or snapping the camera out to 20m.
        if (this.player?.hasMovementInput()) {
          this.player.setCameraTargetDistance(this.player.getCameraArmLength(), true);
          this.enterPlayableDay(false, true);
          break;
        }
        this.introZoomElapsed += _deltaTime;
        const u = Math.min(1, this.introZoomElapsed / INTRO_ZOOM_OUT_SEC);
        const eased = u * u * (3 - 2 * u);
        const dist = THREE.MathUtils.lerp(INTRO_CAMERA_DISTANCE, DEFAULT_CAMERA_DISTANCE, eased);
        this.player?.setCameraTargetDistance(dist, true);
        if (u >= 1) {
          this.player?.setCameraTargetDistance(DEFAULT_CAMERA_DISTANCE, true);
          this.enterPlayableDay(false);
        }
        break;
      }
      case FlowPhase.AwaitingDelivery:
        break;
      case FlowPhase.DeliveryFocus:
        this.player?.setMovementFrozen(true);
        this.player?.forceIdlePose();
        // Wait for mailbox cinematic to settle, then start the envelope.
        if (!this.envelopeStarted && this.cinematicBlend >= 0.98) {
          this.startEnvelopeInsert();
          this.envelopeStarted = true;
        }
        if (this.envelopeStarted && this.envelopeProgress >= 1) {
          this.envelopeFinishedElapsed += _deltaTime;
          if (this.envelopeFinishedElapsed >= DELIVERY_POST_INSERT_SEC) {
            this.clearEnvelope();
            this.setPhase(FlowPhase.FadeToBlack);
          }
        }
        break;
      case FlowPhase.OrdinanceFocus:
        this.player?.setMovementFrozen(true);
        this.player?.forceIdlePose();
        // Count the 3s hold only after the inbound shot has finished blending in.
        if (this.cinematicReturningToPlayer) {
          break;
        }
        if (this.cinematicActive && this.cinematicBlend < 0.98) {
          this.ordinanceFocusHoldElapsed = 0;
          break;
        }
        this.ordinanceFocusHoldElapsed += _deltaTime;
        if (this.ordinanceFocusHoldElapsed >= ORDINANCE_FOCUS_SEC) {
          this.ordinanceFocusHoldElapsed = 0;
          if (this.fadeAfterOrdinanceFocus) {
            this.fadeAfterOrdinanceFocus = false;
            this.setFade(0);
            this.setPhase(FlowPhase.FadeToBlack);
          } else {
            this.beginCinematicReturnToPlayer();
            this.setPhase(FlowPhase.ZoomOutToPlay);
          }
        }
        break;
      case FlowPhase.FadeToBlack: {
        this.player?.setMovementFrozen(true);
        const t = Math.min(1, this.phaseElapsed / FADE_SEC);
        this.setFade(t);
        if (t >= 1) {
          this.setFade(1);
          this.performHiddenTeleport();
          this.showNextDayLabel(true);
          this.setPhase(FlowPhase.HoldBlack);
        }
        break;
      }
      case FlowPhase.HoldBlack:
        this.player?.setMovementFrozen(true);
        this.player?.forceIdlePose();
        this.setFade(1);
        this.tickDayTransitionStaging();
        if (this.isDayTransitionHoldComplete()) {
          this.showNextDayLabel(false);
          this.pendingOrdinance = null;
          this.player?.forceIdlePose();
          this.setPhase(FlowPhase.FadeFromBlack);
        }
        break;
      case FlowPhase.FadeFromBlack: {
        this.player?.setMovementFrozen(true);
        this.player?.forceIdlePose();
        this.showNextDayLabel(false);
        const t = Math.min(1, this.phaseElapsed / FADE_SEC);
        this.setFade(1 - t);
        if (t >= 1) {
          this.setFade(0);
          this.player?.forceIdlePose();
          if (this.focusOrdinanceOnWake) {
            this.focusOrdinanceOnWake = false;
            this.pendingRoadHighlight = 'mainRoad';
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusJaywalkingOnWake) {
            this.focusJaywalkingOnWake = false;
            this.pendingRoadHighlight = 'leftSideRoad';
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDoNotStepCarOnWake) {
            this.focusDoNotStepCarOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDoNotStepTramOnWake) {
            this.focusDoNotStepTramOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusStreetLightsClimbOnWake) {
            this.focusStreetLightsClimbOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDontDestroyTheStreetLightsOnWake) {
            this.focusDontDestroyTheStreetLightsOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDontFeedTheCatOnWake) {
            this.focusDontFeedTheCatOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusNoCatsOnStreetsOnWake) {
            this.focusNoCatsOnStreetsOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusNoCratesOnRoadsOnWake) {
            this.focusNoCratesOnRoadsOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusNoBenchOnRoadsOnWake) {
            this.focusNoBenchOnRoadsOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusNoLogsOnRoadsOnWake) {
            this.focusNoLogsOnRoadsOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusNoWoodPlanksOnRoadsOnWake) {
            this.focusNoWoodPlanksOnRoadsOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDontRemoveTheConesOnWake) {
            this.focusDontRemoveTheConesOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusNoScrapMetalsOnRoadsOnWake) {
            this.focusNoScrapMetalsOnRoadsOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDontRemoveThisBushOnWake) {
            this.focusDontRemoveThisBushOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDontRemoveThisKioskOnWake) {
            this.focusDontRemoveThisKioskOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDontCutThisPoleOnWake) {
            this.focusDontCutThisPoleOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDoNotDestroyThisSignOnWake) {
            this.focusDoNotDestroyThisSignOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDontHitTheFireHydrantOnWake) {
            this.focusDontHitTheFireHydrantOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusHighVoltageOnWake) {
            this.focusHighVoltageOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusNoCuttingOfTreesOnWake) {
            this.focusNoCuttingOfTreesOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusNoClimbingOnTheTreeOnWake) {
            this.focusNoClimbingOnTheTreeOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else if (this.focusDoNotRemoveTheSignsOnWake) {
            this.focusDoNotRemoveTheSignsOnWake = false;
            this.fadeAfterOrdinanceFocus = false;
            this.ordinanceFocusHoldElapsed = 0;
            this.player?.setCinematicCameraLock(true);
            this.setPhase(FlowPhase.OrdinanceFocus);
          } else {
            this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
            this.enterPlayableDay(true);
          }
        }
        break;
      }
      case FlowPhase.NextDayLabel:
        this.showNextDayLabel(false);
        this.enterPlayableDay(true);
        break;
      case FlowPhase.ZoomOutToPlay:
        this.player?.setMovementFrozen(true);
        this.player?.forceIdlePose();
        if (!this.cinematicActive || this.cinematicBlend >= 1 || this.phaseElapsed > 5) {
          this.finishCinematicReturnToPlayer();
          this.enterPlayableDay(true);
          // Only reveal the road cue after the camera has returned to gameplay distance.
          this.beginPendingRoadHighlight();
        }
        break;
      default:
        break;
    }
  }

  private setPhase(phase: FlowPhase): void {
    this.phase = phase;
    this.phaseElapsed = 0;
  }

  private beginIntroSpeech(): void {
    this.stopModelFrontCinematic();
    this.player?.setCinematicCameraLock(true);
    this.player?.setCameraTargetDistance(INTRO_CAMERA_DISTANCE, true);
    this.setPhase(FlowPhase.IntroSpeech);
    this.showSpeechBubble(this.introSpeechText);
  }

  private enterPlayableDay(resetPathUsage: boolean, preserveCurrentCamera = false): void {
    if (resetPathUsage) {
      this.pendingOrdinance = null;
      this.mainRoadLoopTriggered = false;
      this.leftSideRoadLoopTriggered = false;
      this.carRoofLoopTriggered = false;
      this.tramRoofLoopTriggered = false;
      this.lampClimbLoopTriggered = false;
      this.dontDestroyTheStreetLightsLoopTriggered = false;
      this.dontFeedTheCatLoopTriggered = false;
      this.noCatsOnStreetsLoopTriggered = false;
      this.noCratesOnRoadsLoopTriggered = false;
      this.noBenchOnRoadsLoopTriggered = false;
      this.noLogsOnRoadsLoopTriggered = false;
      this.noWoodPlanksOnRoadsLoopTriggered = false;
      this.dontRemoveTheConesLoopTriggered = false;
      this.noScrapMetalsOnRoadsLoopTriggered = false;
      this.dontRemoveThisBushLoopTriggered = false;
      this.dontRemoveThisKioskLoopTriggered = false;
      this.dontCutThisPoleLoopTriggered = false;
      this.doNotDestroyThisSignLoopTriggered = false;
      this.dontHitTheFireHydrantLoopTriggered = false;
      this.highVoltageLoopTriggered = false;
      this.noCuttingOfTreesLoopTriggered = false;
      this.noClimbingOnTheTreeLoopTriggered = false;
      this.doNotRemoveTheSignsLoopTriggered = false;
      this.clearRouteCandidates();
      this.hasTreeClimbFocusAnchor = false;
      this.treeCutSoftLoopDelayRemaining = 0;
      this.kioskDismantleSoftLoopDelayRemaining = 0;
      this.signsSoftLoopDelayRemaining = 0;
      this.conePickupCarryElapsed = 0;
      this.bushWearCarryElapsed = 0;
      this.poleCutSoftLoopDelayRemaining = 0;
      this.kanjiSignSoftLoopDelayRemaining = 0;
      this.fireHydrantSoftLoopDelayRemaining = 0;
      this.treeCutSoftLoopDelayRemaining = 0;
      this.signsSoftLoopDelayRemaining = 0;
      this.streetLampDestroySoftLoopDelayRemaining = 0;
    }
    this.stopModelFrontCinematic();
    this.playableGraceRemaining = 1.35;
    this.setMailboxHoverOutline(false);
    this.setMailboxHighlight(true);
    this.trailVisibleRemaining = resetPathUsage
      ? LATER_DAY_TRAIL_DURATION_SEC
      : Number.POSITIVE_INFINITY;
    this.setTrailVisible(true);
    this.player?.setMailEnvelopeCarried(true);
    this.player?.setMailDeliveryClickHandler(() => this.tryDeliverByClick());
    this.player?.forceIdlePose();
    this.player?.setMovementFrozen(false);
    this.player?.setCinematicCameraLock(false);
    if (!preserveCurrentCamera) {
      this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
    }
    this.captureSessionBaseline();
    this.setPhase(FlowPhase.AwaitingDelivery);
  }

  private beginOrdinanceFocus(options: {
    fadeToNextDayAfter: boolean;
    target?: ENGINE.ModelMeshNode | null;
    /** Soft-loop: blend from a pose captured before day-reset / teleport. */
    blendFromCapturedStart?: boolean;
  }): void {
    this.fadeAfterOrdinanceFocus = options.fadeToNextDayAfter;
    this.ordinanceFocusHoldElapsed = 0;
    this.setMailboxHoverOutline(false);
    this.setMailboxHighlight(false);
    this.setTrailVisible(false);
    this.player?.setMovementFrozen(true);
    this.player?.setCinematicCameraLock(true);
    const target = options.target ?? this.maintenance;
    this.startModelFrontCinematic(
      target,
      MODEL_FOCUS_DISTANCE,
      false,
      0,
      options.blendFromCapturedStart === true,
    );
    this.setPhase(FlowPhase.OrdinanceFocus);
  }

  private tryDeliverByClick(): boolean {
    if (this.phase !== FlowPhase.AwaitingDelivery) {
      return false;
    }
    if (this.catMailCourier.tryInteractByClick()) {
      this.player?.setMailEnvelopeCarried(false);
      return true;
    }
    if (!this.isMailboxInRange() || !this.isAimingAtMailbox()) {
      return false;
    }
    this.deliveryVia = 'mailboxClick';
    this.resolvePendingOrdinanceForSuccessfulDelivery();
    this.completeDelivery();
    return true;
  }

  private clearRouteCandidates(): void {
    this.routeCandidates.clear();
    this.routeCandidateAt.clear();
    this.routeCandidateStamp = 0;
    this.deliveryVia = null;
  }

  /**
   * Elevated / platform routes that reach the mailbox without bare-wire walking.
   * Any of these supersedes High Voltage for unlock priority.
   */
  private isWireBypassRouteCandidate(id: DeliveryRouteCandidate): boolean {
    return id !== 'highVoltage'
      && id !== 'dontFeedTheCat'
      && id !== 'noCatsOnStreets'
      && id !== 'noCuttingOfTrees';
  }

  private hasWireBypassRouteCandidate(): boolean {
    for (const id of this.routeCandidates) {
      if (this.isWireBypassRouteCandidate(id) && !this.isRouteOrdinanceActive(id)) {
        return true;
      }
    }
    return false;
  }

  private clearHighVoltageRouteCandidate(): void {
    this.routeCandidates.delete('highVoltage');
    this.routeCandidateAt.delete('highVoltage');
  }

  private markRouteCandidate(id: DeliveryRouteCandidate): void {
    if (this.isRouteOrdinanceActive(id)) {
      return;
    }
    // Bare-wire HV must not steal unlock from lamp / kanji / tram / pole / tree / kiosk…
    if (id === 'highVoltage' && this.hasWireBypassRouteCandidate()) {
      return;
    }
    if (this.isWireBypassRouteCandidate(id)) {
      this.clearHighVoltageRouteCandidate();
    }
    // Tree canopy is easy to brush while using tram / lamps / signs — those beat tree.
    if (
      id === 'streetLightsClimb'
      || id === 'doNotStepTram'
      || id === 'doNotDestroyThisSign'
      || id === 'doNotRemoveTheSigns'
    ) {
      this.routeCandidates.delete('noClimbingOnTheTree');
      this.routeCandidateAt.delete('noClimbingOnTheTree');
    }
    // Tree climb: first contact only (continuous canopy standing must not out-stamp others).
    if (id === 'noClimbingOnTheTree' && this.routeCandidates.has(id)) {
      return;
    }
    this.routeCandidates.add(id);
    this.routeCandidateStamp += 1;
    this.routeCandidateAt.set(id, this.routeCandidateStamp);
  }

  private isRouteOrdinanceActive(id: DeliveryRouteCandidate): boolean {
    switch (id) {
      case 'noCatsOnStreets':
        return this.noCatsOnStreetsOrdinanceActive;
      case 'dontFeedTheCat':
        return this.dontFeedTheCatOrdinanceActive;
      case 'noCuttingOfTrees':
        return this.noCuttingOfTreesOrdinanceActive;
      case 'dontRemoveThisKiosk':
        return this.dontRemoveThisKioskOrdinanceActive;
      case 'noClimbingOnTheTree':
        return this.noClimbingOnTheTreeOrdinanceActive;
      case 'dontCutThisPole':
        return this.dontCutThisPoleOrdinanceActive;
      case 'doNotDestroyThisSign':
        return this.doNotDestroyThisSignOrdinanceActive;
      case 'doNotRemoveTheSigns':
        return this.doNotRemoveTheSignsOrdinanceActive;
      case 'dontDestroyTheStreetLights':
        return this.dontDestroyTheStreetLightsOrdinanceActive;
      case 'dontRemoveTheCones':
        return this.dontRemoveTheConesOrdinanceActive;
      case 'streetLightsClimb':
        return this.streetLightsClimbOrdinanceActive;
      case 'highVoltage':
        return this.highVoltageOrdinanceActive;
      case 'doNotStepTram':
        return this.doNotStepTramOrdinanceActive;
      case 'doNotStepCar':
        return this.doNotStepCarOrdinanceActive;
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  }

  /** Lower number = higher priority (tie-break; also used when filtering tree climb). */
  private routePriority(id: DeliveryRouteCandidate): number {
    switch (id) {
      case 'noCatsOnStreets':
        return 1;
      case 'dontFeedTheCat':
        return 2;
      case 'noCuttingOfTrees':
        return 3;
      case 'dontRemoveThisKiosk':
        return 4;
      case 'doNotDestroyThisSign':
        return 5;
      case 'streetLightsClimb':
        return 6;
      case 'doNotStepTram':
        return 7;
      case 'doNotStepCar':
        return 8;
      case 'dontCutThisPole':
        return 9;
      case 'doNotRemoveTheSigns':
        return 10;
      case 'dontDestroyTheStreetLights':
        return 11;
      case 'dontRemoveTheCones':
        return 12;
      case 'noClimbingOnTheTree':
        return 20;
      case 'highVoltage':
        return 21;
      default: {
        const _exhaustive: never = id;
        return _exhaustive;
      }
    }
  }

  private isCarryingCleanTreeLog(): boolean {
    const carried = this.player?.getCarriedObject() ?? null;
    if (!(carried instanceof ENGINE.ModelMeshNode) || !this.isCarryableLogProp(carried)) {
      return false;
    }
    return !this.logsThatTouchedRoad.has(carried);
  }

  /**
   * Pick at most one delivery-route ordinance after a successful mail delivery.
   * Family A pending (roads / litter / etc.) is left alone.
   */
  private resolvePendingOrdinanceForSuccessfulDelivery(): void {
    if (this.pendingOrdinance) {
      return;
    }

    if (this.deliveryVia === 'catUnfed' && !this.noCatsOnStreetsOrdinanceActive) {
      this.pendingOrdinance = 'noCatsOnStreets';
      return;
    }
    if (this.deliveryVia === 'catPeach' && !this.dontFeedTheCatOrdinanceActive) {
      this.pendingOrdinance = 'dontFeedTheCat';
      return;
    }

    if (this.isCarryingCleanTreeLog() && !this.noCuttingOfTreesOrdinanceActive) {
      this.markRouteCandidate('noCuttingOfTrees');
    }

    const eligible = [...this.routeCandidates].filter((id) => !this.isRouteOrdinanceActive(id));
    const hasBypass = eligible.some((id) => this.isWireBypassRouteCandidate(id));
    let filtered = hasBypass
      ? eligible.filter((id) => id !== 'highVoltage')
      : eligible;
    // Tree climb loses to intentional elevated routes even if stamped later.
    const treeBeatenBy: DeliveryRouteCandidate[] = [
      'doNotDestroyThisSign',
      'doNotRemoveTheSigns',
      'streetLightsClimb',
      'doNotStepTram',
    ];
    if (filtered.some((id) => treeBeatenBy.includes(id))) {
      filtered = filtered.filter((id) => id !== 'noClimbingOnTheTree');
    }
    if (filtered.length === 0) {
      return;
    }

    filtered.sort((a, b) => {
      const stampDiff = (this.routeCandidateAt.get(b) ?? 0) - (this.routeCandidateAt.get(a) ?? 0);
      if (stampDiff !== 0) {
        return stampDiff;
      }
      return this.routePriority(a) - this.routePriority(b);
    });

    this.pendingOrdinance = filtered[0];
  }

  private isMailboxInRange(): boolean {
    if (!this.player || !this.mailbox) {
      return false;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpBounds.setFromObject(this.mailbox);
    if (this.tmpBounds.isEmpty()) {
      this.mailbox.getWorldPosition(this.tmpMailboxPos);
      return this.tmpPlayerPos.distanceTo(this.tmpMailboxPos) <= DELIVER_MAX_DISTANCE;
    }
    this.tmpBounds.clampPoint(this.tmpPlayerPos, this.tmpMailboxPos);
    return this.tmpPlayerPos.distanceTo(this.tmpMailboxPos) <= DELIVER_MAX_DISTANCE;
  }

  /** Cursor aims at mailbox meshes or their expanded bounds (top-down friendly). */
  private isAimingAtMailbox(): boolean {
    if (!this.player || !this.mailbox) {
      return false;
    }
    const camera = this.player.getGameplayCamera();
    if (!camera) {
      return false;
    }
    this.player.getAimNdc(this.tmpNdc);
    this.raycaster.setFromCamera(this.tmpNdc, camera);
    this.raycaster.far = 200;

    const meshes = this.mailbox.getAllMeshes();
    if (meshes.length > 0) {
      const hits = this.raycaster.intersectObjects(meshes, true);
      if (hits.length > 0) {
        return true;
      }
    }

    this.tmpBounds.setFromObject(this.mailbox);
    if (this.tmpBounds.isEmpty()) {
      this.mailbox.getWorldPosition(this.tmpMailboxPos);
      this.tmpBounds.setFromCenterAndSize(this.tmpMailboxPos, new THREE.Vector3(1.2, 2.2, 1.2));
    } else {
      this.tmpBounds.expandByScalar(0.35);
    }
    return this.raycaster.ray.intersectBox(this.tmpBounds, this.tmpHitPoint) !== null;
  }

  private completeDelivery(): void {
    this.player?.setMailEnvelopeCarried(false);
    this.hideSpeechBubble();
    this.setTrailVisible(false);
    this.setMailboxHighlight(false);
    this.setMailboxHoverOutline(false);
    // Scrap shadows are costly for WebGPU; physics stays dynamic so poles settle.
    this.player?.prepareScrapForCinematic();
    this.player?.setMovementFrozen(true);
    this.player?.forceIdlePose();
    this.player?.setCinematicCameraLock(true);
    this.envelopeStarted = false;
    this.envelopeFinishedElapsed = 0;
    this.clearEnvelope();
    this.startModelFrontCinematic(
      this.mailbox,
      MODEL_FOCUS_DISTANCE,
      false,
      MAILBOX_CINEMATIC_PITCH_FROM_FLOOR_DEG,
    );
    this.setPhase(FlowPhase.DeliveryFocus);
  }

  private applyQueuedOrdinanceReveals(): void {
    // Only the first new ordinance broken this day is revealed.
    if (this.pendingOrdinance === 'maintenance' && !this.maintenanceOrdinanceActive) {
      this.revealMaintenanceBlockade();
      this.maintenanceOrdinanceActive = true;
      this.focusOrdinanceOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'jaywalking' && !this.jaywalkingOrdinanceActive) {
      this.revealJaywalkingOrdinance();
      this.jaywalkingOrdinanceActive = true;
      this.focusJaywalkingOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'doNotStepCar' && !this.doNotStepCarOrdinanceActive) {
      this.revealDoNotStepCarOrdinance();
      this.doNotStepCarOrdinanceActive = true;
      this.focusDoNotStepCarOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'doNotStepTram' && !this.doNotStepTramOrdinanceActive) {
      this.revealDoNotStepCityTramOrdinance();
      this.doNotStepTramOrdinanceActive = true;
      this.focusDoNotStepTramOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'streetLightsClimb' && !this.streetLightsClimbOrdinanceActive) {
      this.revealStreetLightsClimbOrdinance();
      this.streetLightsClimbOrdinanceActive = true;
      this.focusStreetLightsClimbOnWake = true;
      return;
    }
    if (
      this.pendingOrdinance === 'dontDestroyTheStreetLights'
      && !this.dontDestroyTheStreetLightsOrdinanceActive
    ) {
      this.revealDontDestroyTheStreetLightsOrdinance();
      this.dontDestroyTheStreetLightsOrdinanceActive = true;
      this.focusDontDestroyTheStreetLightsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontFeedTheCat' && !this.dontFeedTheCatOrdinanceActive) {
      this.revealDontFeedTheCatOrdinance();
      this.dontFeedTheCatOrdinanceActive = true;
      this.focusDontFeedTheCatOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noCatsOnStreets' && !this.noCatsOnStreetsOrdinanceActive) {
      this.revealNoCatsOnStreetsOrdinance();
      this.noCatsOnStreetsOrdinanceActive = true;
      this.focusNoCatsOnStreetsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noCratesOnRoads' && !this.noCratesOnRoadsOrdinanceActive) {
      this.revealNoCratesOnRoadsOrdinance();
      this.noCratesOnRoadsOrdinanceActive = true;
      this.focusNoCratesOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noBenchOnRoads' && !this.noBenchOnRoadsOrdinanceActive) {
      this.revealNoBenchOnRoadsOrdinance();
      this.noBenchOnRoadsOrdinanceActive = true;
      this.focusNoBenchOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noLogsOnRoads' && !this.noLogsOnRoadsOrdinanceActive) {
      this.revealNoLogsOnRoadsOrdinance();
      this.noLogsOnRoadsOrdinanceActive = true;
      this.focusNoLogsOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noWoodPlanksOnRoads' && !this.noWoodPlanksOnRoadsOrdinanceActive) {
      this.revealNoWoodPlanksOnRoadsOrdinance();
      this.noWoodPlanksOnRoadsOrdinanceActive = true;
      this.focusNoWoodPlanksOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontRemoveTheCones' && !this.dontRemoveTheConesOrdinanceActive) {
      this.revealDontRemoveTheConesOrdinance();
      this.dontRemoveTheConesOrdinanceActive = true;
      this.focusDontRemoveTheConesOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noScrapMetalsOnRoads' && !this.noScrapMetalsOnRoadsOrdinanceActive) {
      this.revealNoScrapMetalsOnRoadsOrdinance();
      this.noScrapMetalsOnRoadsOrdinanceActive = true;
      this.focusNoScrapMetalsOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontRemoveThisBush' && !this.dontRemoveThisBushOrdinanceActive) {
      this.revealDontRemoveThisBushOrdinance();
      this.dontRemoveThisBushOrdinanceActive = true;
      this.focusDontRemoveThisBushOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontRemoveThisKiosk' && !this.dontRemoveThisKioskOrdinanceActive) {
      this.revealDontRemoveThisKioskOrdinance();
      this.dontRemoveThisKioskOrdinanceActive = true;
      this.focusDontRemoveThisKioskOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontCutThisPole' && !this.dontCutThisPoleOrdinanceActive) {
      this.revealDontCutThisPoleOrdinance();
      this.dontCutThisPoleOrdinanceActive = true;
      this.focusDontCutThisPoleOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'doNotDestroyThisSign' && !this.doNotDestroyThisSignOrdinanceActive) {
      this.revealDoNotDestroyThisSignOrdinance();
      this.doNotDestroyThisSignOrdinanceActive = true;
      this.focusDoNotDestroyThisSignOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontHitTheFireHydrant' && !this.dontHitTheFireHydrantOrdinanceActive) {
      this.revealDontHitTheFireHydrantOrdinance();
      this.dontHitTheFireHydrantOrdinanceActive = true;
      this.focusDontHitTheFireHydrantOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'highVoltage' && !this.highVoltageOrdinanceActive) {
      this.revealHighVoltageOrdinance();
      this.highVoltageOrdinanceActive = true;
      this.focusHighVoltageOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noCuttingOfTrees' && !this.noCuttingOfTreesOrdinanceActive) {
      this.revealNoCuttingOfTreesOrdinance();
      this.noCuttingOfTreesOrdinanceActive = true;
      this.focusNoCuttingOfTreesOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noClimbingOnTheTree' && !this.noClimbingOnTheTreeOrdinanceActive) {
      this.revealNoClimbingOnTheTreeOrdinance();
      this.noClimbingOnTheTreeOrdinanceActive = true;
      this.focusNoClimbingOnTheTreeOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'doNotRemoveTheSigns' && !this.doNotRemoveTheSignsOrdinanceActive) {
      this.revealDoNotRemoveTheSignsOrdinance();
      this.doNotRemoveTheSignsOrdinanceActive = true;
      this.focusDoNotRemoveTheSignsOnWake = true;
    }
  }

  private ensureWakeOrdinanceCinematic(): void {
    if (this.cinematicActive) {
      return;
    }
    if (this.focusOrdinanceOnWake) {
      this.startModelFrontCinematic(this.maintenance, MODEL_FOCUS_DISTANCE, true);
      return;
    }
    if (this.focusJaywalkingOnWake) {
      this.startModelFrontCinematic(this.jaywalking, MODEL_FOCUS_DISTANCE, true);
      return;
    }
    if (this.focusDoNotStepCarOnWake) {
      this.startModelFrontCinematic(this.doNotStepCar, MODEL_FOCUS_DISTANCE, true);
      return;
    }
    if (this.focusDoNotStepTramOnWake) {
      this.startModelFrontCinematic(this.doNotStepCityTram, MODEL_FOCUS_DISTANCE, true);
      return;
    }
    if (this.focusStreetLightsClimbOnWake) {
      this.startModelFrontCinematic(
        this.findNearestStreetLightsClimb(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusDontDestroyTheStreetLightsOnWake) {
      this.startModelFrontCinematic(
        this.findNearestStreetLightsDestroy(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusDontFeedTheCatOnWake) {
      this.startModelFrontCinematic(
        this.findNearestDontFeedTheCat(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusNoCatsOnStreetsOnWake) {
      this.startModelFrontCinematic(
        this.findNearestNoCatsOnStreets(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusNoCratesOnRoadsOnWake) {
      this.startModelFrontCinematic(
        this.findNearestNoCratesOnRoads(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusNoBenchOnRoadsOnWake) {
      this.startModelFrontCinematic(
        this.findNearestNoBenchOnRoads(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusNoLogsOnRoadsOnWake) {
      this.startModelFrontCinematic(
        this.findNearestNoLogsOnRoads(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusNoWoodPlanksOnRoadsOnWake) {
      this.startModelFrontCinematic(
        this.findNearestNoWoodPlanksOnRoads(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusDontRemoveTheConesOnWake) {
      this.startModelFrontCinematic(
        this.findNearestDontRemoveTheCones(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusNoScrapMetalsOnRoadsOnWake) {
      this.startModelFrontCinematic(
        this.findNearestNoScrapMetalsOnRoads(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusDontRemoveThisBushOnWake) {
      this.startModelFrontCinematic(
        this.findNearestDontRemoveThisBush(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusDontRemoveThisKioskOnWake) {
      this.startModelFrontCinematic(
        this.findNearestDontRemoveThisKiosk(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusDontCutThisPoleOnWake) {
      this.startModelFrontCinematic(
        this.findNearestDontCutThisPole(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusDoNotDestroyThisSignOnWake) {
      this.startModelFrontCinematic(
        this.findNearestDoNotDestroyThisSign(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusDontHitTheFireHydrantOnWake) {
      this.startModelFrontCinematic(
        this.findNearestDontHitTheFireHydrant(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusHighVoltageOnWake) {
      this.startModelFrontCinematic(
        this.findNearestHighVoltage(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusNoCuttingOfTreesOnWake) {
      this.startModelFrontCinematic(
        this.findNearestNoCuttingOfTrees(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusNoClimbingOnTheTreeOnWake) {
      this.startModelFrontCinematic(
        this.findNearestNoClimbingOnTheTree(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
      return;
    }
    if (this.focusDoNotRemoveTheSignsOnWake) {
      this.startModelFrontCinematic(
        this.findNearestDoNotRemoveTheSigns(),
        MODEL_FOCUS_DISTANCE,
        true,
      );
    }
  }

  private revealMaintenanceBlockade(): void {
    this.setOrdinanceVisible(this.maintenance, true);
    this.setOrdinanceVisible(this.cones, true);
    for (const cone of this.trafficCones) {
      this.setOrdinanceVisible(cone, true);
    }
  }

  private revealJaywalkingOrdinance(): void {
    this.setOrdinanceVisible(this.jaywalking, true);
    for (const record of this.hiddenOrdinances) {
      if (JAYWALKING_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDoNotStepCarOrdinance(): void {
    this.setOrdinanceVisible(this.doNotStepCar, true);
    for (const record of this.hiddenOrdinances) {
      if (DO_NOT_STEP_CAR_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDoNotStepCityTramOrdinance(): void {
    this.setOrdinanceVisible(this.doNotStepCityTram, true);
    for (const record of this.hiddenOrdinances) {
      if (DO_NOT_STEP_CITY_TRAM_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealStreetLightsClimbOrdinance(): void {
    if (this.streetLightsClimbOrdinances.length === 0) {
      this.cacheStreetLightsClimbOrdinances();
    }
    for (const node of this.streetLightsClimbOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (STREET_LIGHTS_CLIMB_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDontDestroyTheStreetLightsOrdinance(): void {
    if (this.streetLightsDestroyOrdinances.length === 0) {
      this.cacheStreetLightsDestroyOrdinances();
    }
    for (const node of this.streetLightsDestroyOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (STREET_LIGHTS_DESTROY_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDontFeedTheCatOrdinance(): void {
    if (this.dontFeedTheCatOrdinances.length === 0) {
      this.cacheDontFeedTheCatOrdinances();
    }
    for (const node of this.dontFeedTheCatOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (DONT_FEED_THE_CAT_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealNoCatsOnStreetsOrdinance(): void {
    if (this.noCatsOnStreetsOrdinances.length === 0) {
      this.cacheNoCatsOnStreetsOrdinances();
    }
    for (const node of this.noCatsOnStreetsOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (NO_CATS_ON_STREETS_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealNoCratesOnRoadsOrdinance(): void {
    if (this.noCratesOnRoadsOrdinances.length === 0) {
      this.cacheNoCratesOnRoadsOrdinances();
    }
    for (const node of this.noCratesOnRoadsOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (NO_CRATES_ON_ROADS_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealNoBenchOnRoadsOrdinance(): void {
    if (this.noBenchOnRoadsOrdinances.length === 0) {
      this.cacheNoBenchOnRoadsOrdinances();
    }
    for (const node of this.noBenchOnRoadsOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (NO_BENCH_ON_ROADS_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealNoLogsOnRoadsOrdinance(): void {
    if (this.noLogsOnRoadsOrdinances.length === 0) {
      this.cacheNoLogsOnRoadsOrdinances();
    }
    for (const node of this.noLogsOnRoadsOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (NO_LOGS_ON_ROADS_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealNoWoodPlanksOnRoadsOrdinance(): void {
    if (this.noWoodPlanksOnRoadsOrdinances.length === 0) {
      this.cacheNoWoodPlanksOnRoadsOrdinances();
    }
    for (const node of this.noWoodPlanksOnRoadsOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (NO_WOOD_PLANKS_ON_ROADS_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDontRemoveTheConesOrdinance(): void {
    if (this.dontRemoveTheConesOrdinances.length === 0) {
      this.cacheDontRemoveTheConesOrdinances();
    }
    for (const node of this.dontRemoveTheConesOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (DONT_REMOVE_THE_CONES_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealNoScrapMetalsOnRoadsOrdinance(): void {
    if (this.noScrapMetalsOnRoadsOrdinances.length === 0) {
      this.cacheNoScrapMetalsOnRoadsOrdinances();
    }
    for (const node of this.noScrapMetalsOnRoadsOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (NO_SCRAP_METALS_ON_ROADS_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDontRemoveThisBushOrdinance(): void {
    if (this.dontRemoveThisBushOrdinances.length === 0) {
      this.cacheDontRemoveThisBushOrdinances();
    }
    for (const node of this.dontRemoveThisBushOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (DONT_REMOVE_THIS_BUSH_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDontRemoveThisKioskOrdinance(): void {
    if (this.dontRemoveThisKioskOrdinances.length === 0) {
      this.cacheDontRemoveThisKioskOrdinances();
    }
    for (const node of this.dontRemoveThisKioskOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (DONT_REMOVE_THIS_KIOSK_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDontCutThisPoleOrdinance(): void {
    if (this.dontCutThisPoleOrdinances.length === 0) {
      this.cacheDontCutThisPoleOrdinances();
    }
    for (const node of this.dontCutThisPoleOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (DONT_CUT_THIS_POLE_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDoNotDestroyThisSignOrdinance(): void {
    if (this.doNotDestroyThisSignOrdinances.length === 0) {
      this.cacheDoNotDestroyThisSignOrdinances();
    }
    for (const node of this.doNotDestroyThisSignOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (DO_NOT_DESTROY_THIS_SIGN_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDontHitTheFireHydrantOrdinance(): void {
    if (this.dontHitTheFireHydrantOrdinances.length === 0) {
      this.cacheDontHitTheFireHydrantOrdinances();
    }
    for (const node of this.dontHitTheFireHydrantOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (DONT_HIT_THE_FIRE_HYDRANT_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealHighVoltageOrdinance(): void {
    if (this.highVoltageOrdinances.length === 0) {
      this.cacheHighVoltageOrdinances();
    }
    for (const node of this.highVoltageOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (HIGH_VOLTAGE_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealNoCuttingOfTreesOrdinance(): void {
    if (this.noCuttingOfTreesOrdinances.length === 0) {
      this.cacheNoCuttingOfTreesOrdinances();
    }
    for (const node of this.noCuttingOfTreesOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (NO_CUTTING_OF_TREES_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealNoClimbingOnTheTreeOrdinance(): void {
    if (this.noClimbingOnTheTreeOrdinances.length === 0) {
      this.cacheNoClimbingOnTheTreeOrdinances();
    }
    for (const node of this.noClimbingOnTheTreeOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (NO_CLIMBING_ON_THE_TREE_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  private revealDoNotRemoveTheSignsOrdinance(): void {
    if (this.doNotRemoveTheSignsOrdinances.length === 0) {
      this.cacheDoNotRemoveTheSignsOrdinances();
    }
    for (const node of this.doNotRemoveTheSignsOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (DO_NOT_REMOVE_THE_SIGNS_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
    }
  }

  /** After transform restore, keep ordinance visibility tied to escalation flags. */
  private reapplyOrdinanceVisibility(): void {
    for (const record of this.hiddenOrdinances) {
      this.setOrdinanceVisible(record.node, false);
    }
    if (this.maintenanceOrdinanceActive) {
      this.revealMaintenanceBlockade();
    }
    if (this.jaywalkingOrdinanceActive) {
      this.revealJaywalkingOrdinance();
    }
    if (this.doNotStepCarOrdinanceActive) {
      this.revealDoNotStepCarOrdinance();
    }
    if (this.doNotStepTramOrdinanceActive) {
      this.revealDoNotStepCityTramOrdinance();
    }
    if (this.streetLightsClimbOrdinanceActive) {
      this.revealStreetLightsClimbOrdinance();
    }
    if (this.dontDestroyTheStreetLightsOrdinanceActive) {
      this.revealDontDestroyTheStreetLightsOrdinance();
    }
    if (this.dontFeedTheCatOrdinanceActive) {
      this.revealDontFeedTheCatOrdinance();
    }
    if (this.noCatsOnStreetsOrdinanceActive) {
      this.revealNoCatsOnStreetsOrdinance();
    }
    if (this.noCratesOnRoadsOrdinanceActive) {
      this.revealNoCratesOnRoadsOrdinance();
    }
    if (this.noBenchOnRoadsOrdinanceActive) {
      this.revealNoBenchOnRoadsOrdinance();
    }
    if (this.noLogsOnRoadsOrdinanceActive) {
      this.revealNoLogsOnRoadsOrdinance();
    }
    if (this.noWoodPlanksOnRoadsOrdinanceActive) {
      this.revealNoWoodPlanksOnRoadsOrdinance();
    }
    if (this.dontRemoveTheConesOrdinanceActive) {
      this.revealDontRemoveTheConesOrdinance();
    }
    if (this.noScrapMetalsOnRoadsOrdinanceActive) {
      this.revealNoScrapMetalsOnRoadsOrdinance();
    }
    if (this.dontRemoveThisBushOrdinanceActive) {
      this.revealDontRemoveThisBushOrdinance();
    }
    if (this.dontRemoveThisKioskOrdinanceActive) {
      this.revealDontRemoveThisKioskOrdinance();
    }
    if (this.dontCutThisPoleOrdinanceActive) {
      this.revealDontCutThisPoleOrdinance();
    }
    if (this.doNotDestroyThisSignOrdinanceActive) {
      this.revealDoNotDestroyThisSignOrdinance();
    }
    if (this.dontHitTheFireHydrantOrdinanceActive) {
      this.revealDontHitTheFireHydrantOrdinance();
    }
    if (this.highVoltageOrdinanceActive) {
      this.revealHighVoltageOrdinance();
    }
    if (this.noCuttingOfTreesOrdinanceActive) {
      this.revealNoCuttingOfTreesOrdinance();
    }
    if (this.noClimbingOnTheTreeOrdinanceActive) {
      this.revealNoClimbingOnTheTreeOrdinance();
    }
    if (this.doNotRemoveTheSignsOrdinanceActive) {
      this.revealDoNotRemoveTheSignsOrdinance();
    }
  }

  private triggerBlockedMainRoadLoop(): void {
    this.startRoadHighlight('mainRoad');
    this.beginImmediateSoftLoop(this.maintenance);
  }

  private triggerBlockedJaywalkingLoop(): void {
    this.startRoadHighlight('leftSideRoad');
    this.beginImmediateSoftLoop(this.jaywalking);
  }

  private triggerBlockedDoNotStepCarLoop(): void {
    this.beginImmediateSoftLoop(this.doNotStepCar);
  }

  private triggerBlockedDoNotStepTramLoop(): void {
    this.beginImmediateSoftLoop(this.doNotStepCityTram);
  }

  private triggerBlockedStreetLightsClimbLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestStreetLightsClimb());
  }

  private triggerBlockedDontDestroyTheStreetLightsLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestStreetLightsDestroy());
  }

  private triggerBlockedDontFeedTheCatLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestDontFeedTheCat());
  }

  private triggerBlockedNoCatsOnStreetsLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestNoCatsOnStreets());
  }

  private triggerBlockedNoCratesOnRoadsLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestNoCratesOnRoads());
  }

  private triggerBlockedNoBenchOnRoadsLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestNoBenchOnRoads());
  }

  private triggerBlockedNoLogsOnRoadsLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestNoLogsOnRoads());
  }

  private triggerBlockedNoWoodPlanksOnRoadsLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestNoWoodPlanksOnRoads());
  }

  private triggerBlockedDontRemoveTheConesLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestDontRemoveTheCones());
  }

  private triggerBlockedNoScrapMetalsOnRoadsLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestNoScrapMetalsOnRoads());
  }

  private triggerBlockedDontRemoveThisBushLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestDontRemoveThisBush());
  }

  private triggerBlockedDontRemoveThisKioskLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestDontRemoveThisKiosk());
  }

  private triggerBlockedDontCutThisPoleLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestDontCutThisPole());
  }

  private triggerBlockedDoNotDestroyThisSignLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestDoNotDestroyThisSign());
  }

  private triggerBlockedDontHitTheFireHydrantLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestDontHitTheFireHydrant());
  }

  private triggerBlockedHighVoltageLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestHighVoltage());
  }

  private triggerBlockedNoCuttingOfTreesLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestNoCuttingOfTrees());
  }

  private triggerBlockedNoClimbingOnTheTreeLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestNoClimbingOnTheTree());
  }

  private triggerBlockedDoNotRemoveTheSignsLoop(): void {
    this.beginImmediateSoftLoop(this.findNearestDoNotRemoveTheSigns());
  }

  /** Soft-loop: reset day state, then smoothly zoom from the player's last view onto the board. */
  private beginImmediateSoftLoop(target: ENGINE.ModelMeshNode | null): void {
    this.setMailboxHoverOutline(false);
    this.setMailboxHighlight(false);
    this.setTrailVisible(false);

    // Capture the live gameplay camera before teleport/reset so we don't snap.
    const active = this.getWorld()?.getActiveCamera();
    if (active) {
      active.updateMatrixWorld(true);
      active.getWorldPosition(this.cinematicStartPos);
      active.getWorldQuaternion(this.cinematicStartQuat);
    }

    this.player?.prepareForDayReset();
    this.restoreDayBaseline();
    this.baselineReinforceRemaining = 10;
    this.player?.teleportToPlayerStartAndSettle();
    // Keep orbit camera where it was for this frame; cinematic owns the view next.
    this.beginOrdinanceFocus({
      fadeToNextDayAfter: false,
      target,
      blendFromCapturedStart: true,
    });
  }

  private onMainRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.maintenanceOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.mainRoadLoopTriggered
    ) {
      this.mainRoadLoopTriggered = true;
      this.triggerBlockedMainRoadLoop();
      return;
    }

    // First unbroken ordinance stepped today wins; later roads are ignored.
    if (!this.pendingOrdinance && !this.maintenanceOrdinanceActive) {
      this.pendingOrdinance = 'maintenance';
    }
  }

  private onLeftSideRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.jaywalkingOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.leftSideRoadLoopTriggered
    ) {
      this.leftSideRoadLoopTriggered = true;
      this.triggerBlockedJaywalkingLoop();
      return;
    }

    if (!this.pendingOrdinance && !this.jaywalkingOrdinanceActive) {
      this.pendingOrdinance = 'jaywalking';
    }
  }

  private onCarRoofContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.doNotStepCarOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.carRoofLoopTriggered
    ) {
      this.carRoofLoopTriggered = true;
      this.triggerBlockedDoNotStepCarLoop();
      return;
    }

    if (!this.doNotStepCarOrdinanceActive) {
      this.markRouteCandidate('doNotStepCar');
    }
  }

  private onTramRoofContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.doNotStepTramOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.tramRoofLoopTriggered
    ) {
      this.tramRoofLoopTriggered = true;
      this.triggerBlockedDoNotStepTramLoop();
      return;
    }

    if (!this.doNotStepTramOrdinanceActive) {
      this.markRouteCandidate('doNotStepTram');
    }
  }

  private onLampClimbContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.streetLightsClimbOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.lampClimbLoopTriggered
    ) {
      this.lampClimbLoopTriggered = true;
      this.triggerBlockedStreetLightsClimbLoop();
      return;
    }

    if (!this.streetLightsClimbOrdinanceActive) {
      this.markRouteCandidate('streetLightsClimb');
    }
  }

  private onCargoCrateOnRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.noCratesOnRoadsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.noCratesOnRoadsLoopTriggered
    ) {
      this.noCratesOnRoadsLoopTriggered = true;
      this.triggerBlockedNoCratesOnRoadsLoop();
      return;
    }

    if (!this.pendingOrdinance && !this.noCratesOnRoadsOrdinanceActive) {
      this.pendingOrdinance = 'noCratesOnRoads';
    }
  }

  private onParkBenchOnRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.noBenchOnRoadsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.noBenchOnRoadsLoopTriggered
    ) {
      this.noBenchOnRoadsLoopTriggered = true;
      this.triggerBlockedNoBenchOnRoadsLoop();
      return;
    }

    if (!this.pendingOrdinance && !this.noBenchOnRoadsOrdinanceActive) {
      this.pendingOrdinance = 'noBenchOnRoads';
    }
  }

  private onLogOnRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.noLogsOnRoadsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.noLogsOnRoadsLoopTriggered
    ) {
      this.noLogsOnRoadsLoopTriggered = true;
      this.triggerBlockedNoLogsOnRoadsLoop();
      return;
    }

    if (!this.pendingOrdinance && !this.noLogsOnRoadsOrdinanceActive) {
      this.pendingOrdinance = 'noLogsOnRoads';
    }
  }

  private onKioskWoodOnRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.noWoodPlanksOnRoadsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.noWoodPlanksOnRoadsLoopTriggered
    ) {
      this.noWoodPlanksOnRoadsLoopTriggered = true;
      this.triggerBlockedNoWoodPlanksOnRoadsLoop();
      return;
    }

    if (!this.pendingOrdinance && !this.noWoodPlanksOnRoadsOrdinanceActive) {
      this.pendingOrdinance = 'noWoodPlanksOnRoads';
    }
  }

  /**
   * @param source `platform` = delivery-route candidate; `dismantle` = Family A (5th axe hit).
   */
  private onDontRemoveTheConesContact(source: 'platform' | 'dismantle'): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.dontRemoveTheConesOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.dontRemoveTheConesLoopTriggered
    ) {
      this.dontRemoveTheConesLoopTriggered = true;
      this.triggerBlockedDontRemoveTheConesLoop();
      return;
    }

    if (this.dontRemoveTheConesOrdinanceActive) {
      return;
    }

    if (source === 'platform') {
      this.markRouteCandidate('dontRemoveTheCones');
      return;
    }

    if (!this.pendingOrdinance) {
      this.pendingOrdinance = 'dontRemoveTheCones';
    }
  }

  private onScrapMetalOnRoadContact(fromFallenOrdinanceSign = false): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    // Metal ordinance boards: unlock Do not remove the SIGNS before No Scrap Metals
    // when these boards are the first scrap-metal contact of the day.
    // Street-lamp Metal Scrapt never diverts — always No Scrap Metals when on a road.
    if (fromFallenOrdinanceSign && !this.doNotRemoveTheSignsOrdinanceActive) {
      this.onDontRemoveTheSignsContact('roadRest');
      return;
    }

    if (
      this.noScrapMetalsOnRoadsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.noScrapMetalsOnRoadsLoopTriggered
    ) {
      this.noScrapMetalsOnRoadsLoopTriggered = true;
      this.triggerBlockedNoScrapMetalsOnRoadsLoop();
      return;
    }

    if (!this.pendingOrdinance && !this.noScrapMetalsOnRoadsOrdinanceActive) {
      this.pendingOrdinance = 'noScrapMetalsOnRoads';
    }
  }

  private onDontRemoveThisBushContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    // Soft-loop after active is handled by pollBushWearSoftLoop (wear first, then trigger).
    if (this.dontRemoveThisBushOrdinanceActive) {
      return;
    }

    if (!this.pendingOrdinance) {
      this.pendingOrdinance = 'dontRemoveThisBush';
    }
  }

  private onDontCutThisPoleContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.dontCutThisPoleOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.dontCutThisPoleLoopTriggered
    ) {
      this.dontCutThisPoleLoopTriggered = true;
      this.triggerBlockedDontCutThisPoleLoop();
      return;
    }

    if (!this.dontCutThisPoleOrdinanceActive) {
      this.markRouteCandidate('dontCutThisPole');
    }
  }

  /** 5th axe hit on a Traffic Cone C (from StreetLampDismantlingSystem). */
  private onTrafficConeFifthHit(): void {
    this.onDontRemoveTheConesContact('dismantle');
  }

  /**
   * After DontCutThisPole is active: axe finishes dismantling a pole → delay → soft loop
   * so the fallen prefab is visible first.
   */
  private onUtilityPoleDismantled(): void {
    if (this.playableGraceRemaining > 0 || !this.dontCutThisPoleOrdinanceActive) {
      return;
    }
    if (this.phase !== FlowPhase.AwaitingDelivery || this.dontCutThisPoleLoopTriggered) {
      return;
    }
    if (this.poleCutSoftLoopDelayRemaining > 0) {
      return;
    }
    this.poleCutSoftLoopDelayRemaining = this.poleCutSoftLoopDelaySec;
  }

  private pollPoleCutSoftLoop(deltaTime: number): void {
    if (this.poleCutSoftLoopDelayRemaining <= 0) {
      return;
    }
    if (
      this.playableGraceRemaining > 0
      || !this.dontCutThisPoleOrdinanceActive
      || this.phase !== FlowPhase.AwaitingDelivery
      || this.dontCutThisPoleLoopTriggered
    ) {
      this.poleCutSoftLoopDelayRemaining = 0;
      return;
    }

    this.poleCutSoftLoopDelayRemaining -= deltaTime;
    if (this.poleCutSoftLoopDelayRemaining > 0) {
      return;
    }

    this.poleCutSoftLoopDelayRemaining = 0;
    this.dontCutThisPoleLoopTriggered = true;
    this.triggerBlockedDontCutThisPoleLoop();
  }

  /**
   * First Kanji Sign dismantle queues Do not destroy this sign.
   * After active: dismantle again → wait for pose-fall → soft loop.
   */
  private onKanjiSignDismantled(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.doNotDestroyThisSignOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.doNotDestroyThisSignLoopTriggered
    ) {
      if (this.kanjiSignSoftLoopDelayRemaining <= 0) {
        this.kanjiSignSoftLoopDelayRemaining = this.kanjiSignSoftLoopDelaySec;
      }
      return;
    }

    if (!this.doNotDestroyThisSignOrdinanceActive) {
      this.markRouteCandidate('doNotDestroyThisSign');
    }
  }

  private pollKanjiSignSoftLoop(deltaTime: number): void {
    if (this.kanjiSignSoftLoopDelayRemaining <= 0) {
      return;
    }
    if (
      this.playableGraceRemaining > 0
      || !this.doNotDestroyThisSignOrdinanceActive
      || this.phase !== FlowPhase.AwaitingDelivery
      || this.doNotDestroyThisSignLoopTriggered
    ) {
      this.kanjiSignSoftLoopDelayRemaining = 0;
      return;
    }

    this.kanjiSignSoftLoopDelayRemaining -= deltaTime;
    if (this.kanjiSignSoftLoopDelayRemaining > 0) {
      return;
    }

    this.kanjiSignSoftLoopDelayRemaining = 0;
    this.doNotDestroyThisSignLoopTriggered = true;
    this.triggerBlockedDoNotDestroyThisSignLoop();
  }

  /**
   * First hydrant water spray queues Dont hit the fire hydrant.
   * After active: spray again → wait 1s → soft loop.
   */
  private onFireHydrantActivated(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.dontHitTheFireHydrantOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.dontHitTheFireHydrantLoopTriggered
    ) {
      if (this.fireHydrantSoftLoopDelayRemaining <= 0) {
        this.fireHydrantSoftLoopDelayRemaining = this.fireHydrantSoftLoopDelaySec;
      }
      return;
    }

    if (!this.pendingOrdinance && !this.dontHitTheFireHydrantOrdinanceActive) {
      this.pendingOrdinance = 'dontHitTheFireHydrant';
    }
  }

  private pollFireHydrantSoftLoop(deltaTime: number): void {
    if (this.fireHydrantSoftLoopDelayRemaining <= 0) {
      return;
    }
    if (
      this.playableGraceRemaining > 0
      || !this.dontHitTheFireHydrantOrdinanceActive
      || this.phase !== FlowPhase.AwaitingDelivery
      || this.dontHitTheFireHydrantLoopTriggered
    ) {
      this.fireHydrantSoftLoopDelayRemaining = 0;
      return;
    }

    this.fireHydrantSoftLoopDelayRemaining -= deltaTime;
    if (this.fireHydrantSoftLoopDelayRemaining > 0) {
      return;
    }

    this.fireHydrantSoftLoopDelayRemaining = 0;
    this.dontHitTheFireHydrantLoopTriggered = true;
    this.triggerBlockedDontHitTheFireHydrantLoop();
  }

  /**
   * After No cutting of trees is active: chopping a cherry tree → delay → soft loop.
   */
  private onCherryTreeDismantled(): void {
    if (this.playableGraceRemaining > 0 || !this.noCuttingOfTreesOrdinanceActive) {
      return;
    }
    if (this.phase !== FlowPhase.AwaitingDelivery || this.noCuttingOfTreesLoopTriggered) {
      return;
    }
    if (this.treeCutSoftLoopDelayRemaining > 0) {
      return;
    }
    this.treeCutSoftLoopDelayRemaining = this.treeCutSoftLoopDelaySec;
  }

  private pollTreeCutSoftLoop(deltaTime: number): void {
    if (this.treeCutSoftLoopDelayRemaining <= 0) {
      return;
    }
    if (
      this.playableGraceRemaining > 0
      || !this.noCuttingOfTreesOrdinanceActive
      || this.phase !== FlowPhase.AwaitingDelivery
      || this.noCuttingOfTreesLoopTriggered
    ) {
      this.treeCutSoftLoopDelayRemaining = 0;
      return;
    }

    this.treeCutSoftLoopDelayRemaining -= deltaTime;
    if (this.treeCutSoftLoopDelayRemaining > 0) {
      return;
    }

    this.treeCutSoftLoopDelayRemaining = 0;
    this.noCuttingOfTreesLoopTriggered = true;
    this.triggerBlockedNoCuttingOfTreesLoop();
  }

  /**
   * After Dont remove this kiosk is active: dismantling the trail map kiosk → delay → soft loop.
   */
  private onTrailMapKioskDismantled(): void {
    if (this.playableGraceRemaining > 0 || !this.dontRemoveThisKioskOrdinanceActive) {
      return;
    }
    if (this.phase !== FlowPhase.AwaitingDelivery || this.dontRemoveThisKioskLoopTriggered) {
      return;
    }
    if (this.kioskDismantleSoftLoopDelayRemaining > 0) {
      return;
    }
    this.kioskDismantleSoftLoopDelayRemaining = this.kioskDismantleSoftLoopDelaySec;
  }

  private pollKioskDismantleSoftLoop(deltaTime: number): void {
    if (this.kioskDismantleSoftLoopDelayRemaining <= 0) {
      return;
    }
    if (
      this.playableGraceRemaining > 0
      || !this.dontRemoveThisKioskOrdinanceActive
      || this.phase !== FlowPhase.AwaitingDelivery
      || this.dontRemoveThisKioskLoopTriggered
    ) {
      this.kioskDismantleSoftLoopDelayRemaining = 0;
      return;
    }

    this.kioskDismantleSoftLoopDelayRemaining -= deltaTime;
    if (this.kioskDismantleSoftLoopDelayRemaining > 0) {
      return;
    }

    this.kioskDismantleSoftLoopDelayRemaining = 0;
    this.dontRemoveThisKioskLoopTriggered = true;
    this.triggerBlockedDontRemoveThisKioskLoop();
  }

  /**
   * Standing on / axing fallen ordinance boards as road platforms unlocks
   * Do not remove the SIGNS. After active: axe a board → tip/fall → soft loop.
   * @param source `platform` / `dismantle` = delivery-route candidates;
   *   `roadRest` = Family A (fallen board resting on asphalt).
   */
  private onDontRemoveTheSignsContact(source: 'platform' | 'dismantle' | 'roadRest'): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.doNotRemoveTheSignsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.doNotRemoveTheSignsLoopTriggered
    ) {
      this.doNotRemoveTheSignsLoopTriggered = true;
      this.triggerBlockedDoNotRemoveTheSignsLoop();
      return;
    }

    if (this.doNotRemoveTheSignsOrdinanceActive) {
      return;
    }

    if (source === 'platform' || source === 'dismantle') {
      this.markRouteCandidate('doNotRemoveTheSigns');
      return;
    }

    if (!this.pendingOrdinance) {
      this.pendingOrdinance = 'doNotRemoveTheSigns';
    }
  }

  /**
   * First ordinance-board axe queues Do not remove the SIGNS.
   * After active: axe again → wait for tip/fall → soft loop.
   */
  private onOrdinanceBoardDismantled(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.doNotRemoveTheSignsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.doNotRemoveTheSignsLoopTriggered
    ) {
      if (this.signsSoftLoopDelayRemaining <= 0) {
        this.signsSoftLoopDelayRemaining = this.signsSoftLoopDelaySec;
      }
      return;
    }

    if (!this.doNotRemoveTheSignsOrdinanceActive) {
      this.markRouteCandidate('doNotRemoveTheSigns');
    }
  }

  private pollSignsSoftLoop(deltaTime: number): void {
    if (this.signsSoftLoopDelayRemaining <= 0) {
      return;
    }
    if (
      this.playableGraceRemaining > 0
      || !this.doNotRemoveTheSignsOrdinanceActive
      || this.phase !== FlowPhase.AwaitingDelivery
      || this.doNotRemoveTheSignsLoopTriggered
    ) {
      this.signsSoftLoopDelayRemaining = 0;
      return;
    }

    this.signsSoftLoopDelayRemaining -= deltaTime;
    if (this.signsSoftLoopDelayRemaining > 0) {
      return;
    }

    this.signsSoftLoopDelayRemaining = 0;
    this.doNotRemoveTheSignsLoopTriggered = true;
    this.triggerBlockedDoNotRemoveTheSignsLoop();
  }

  /**
   * Standing on street-lamp Metal Scrapt over a road (without feet on asphalt)
   * queues Dont destroy the street lights — distinct from scraps resting ON the road
   * (No Scrap Metals).
   */
  private onDontDestroyTheStreetLightsContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.dontDestroyTheStreetLightsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.dontDestroyTheStreetLightsLoopTriggered
    ) {
      this.dontDestroyTheStreetLightsLoopTriggered = true;
      this.triggerBlockedDontDestroyTheStreetLightsLoop();
      return;
    }

    if (!this.dontDestroyTheStreetLightsOrdinanceActive) {
      this.markRouteCandidate('dontDestroyTheStreetLights');
    }
  }

  /**
   * After Dont destroy the street lights is active: axe finishes dismantling a lamp
   * → delay → soft loop so scrap is visible first.
   */
  private onStreetLampDismantled(): void {
    if (this.playableGraceRemaining > 0 || !this.dontDestroyTheStreetLightsOrdinanceActive) {
      return;
    }
    if (this.phase !== FlowPhase.AwaitingDelivery || this.dontDestroyTheStreetLightsLoopTriggered) {
      return;
    }
    if (this.streetLampDestroySoftLoopDelayRemaining > 0) {
      return;
    }
    this.streetLampDestroySoftLoopDelayRemaining = this.streetLampDestroySoftLoopDelaySec;
  }

  /**
   * First peach lure (cat reaches the fruit) queues Dont feed the cat.
   * After active: the next time the cat reaches a peach → soft-loop.
   */
  private onCatReachedPeach(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.dontFeedTheCatOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.dontFeedTheCatLoopTriggered
    ) {
      this.dontFeedTheCatLoopTriggered = true;
      this.triggerBlockedDontFeedTheCatLoop();
      return;
    }

    if (!this.dontFeedTheCatOrdinanceActive) {
      this.markRouteCandidate('dontFeedTheCat');
    }
  }

  /**
   * Click the cat without peach-feeding it → No cats on streets.
   * After active: the next unfed click → soft-loop.
   */
  private onCatClickedUnfed(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.noCatsOnStreetsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.noCatsOnStreetsLoopTriggered
    ) {
      this.noCatsOnStreetsLoopTriggered = true;
      this.triggerBlockedNoCatsOnStreetsLoop();
      return;
    }

    if (!this.noCatsOnStreetsOrdinanceActive) {
      this.markRouteCandidate('noCatsOnStreets');
    }
  }

  private pollStreetLampDestroySoftLoop(deltaTime: number): void {
    if (this.streetLampDestroySoftLoopDelayRemaining <= 0) {
      return;
    }
    if (
      this.playableGraceRemaining > 0
      || !this.dontDestroyTheStreetLightsOrdinanceActive
      || this.phase !== FlowPhase.AwaitingDelivery
      || this.dontDestroyTheStreetLightsLoopTriggered
    ) {
      this.streetLampDestroySoftLoopDelayRemaining = 0;
      return;
    }

    this.streetLampDestroySoftLoopDelayRemaining -= deltaTime;
    if (this.streetLampDestroySoftLoopDelayRemaining > 0) {
      return;
    }

    this.streetLampDestroySoftLoopDelayRemaining = 0;
    this.dontDestroyTheStreetLightsLoopTriggered = true;
    this.triggerBlockedDontDestroyTheStreetLightsLoop();
  }

  /**
   * Feet-on-tile: sample the capsule bottom (root is center), then test that point in
   * each MainRoad tile's local XZ (4×4 mesh / 8×8 world) and world Y near the asphalt.
   */
  private pollMainRoadFeetContact(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    // Bush disguise: not a person on the road — skip Maintenance detection.
    if (this.player.isWearingBush()) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }
    if (this.mainRoadNodes.length === 0) {
      this.cacheMainRoads();
    }
    if (!this.isPlayerFeetOnRoadTiles(this.mainRoadNodes)) {
      return;
    }
    this.onMainRoadContact();
  }

  private pollLeftSideRoadFeetContact(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    // Bush disguise: not a person on the road — skip JayWalking detection.
    if (this.player.isWearingBush()) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }
    if (this.leftSideRoadNodes.length === 0) {
      this.cacheLeftSideRoads();
    }
    if (!this.isPlayerFeetOnRoadTiles(this.leftSideRoadNodes)) {
      return;
    }
    this.onLeftSideRoadContact();
  }

  private pollCarRoofFeetContact(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }
    if (this.carRoofTriggers.length === 0) {
      this.cacheClimbCarsAndRoofTriggers();
    }
    if (!this.isPlayerFeetInsideTriggers(this.carRoofTriggers)) {
      return;
    }
    this.onCarRoofContact();
  }

  private pollTramRoofFeetContact(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }
    if (this.tramRoofTriggers.length === 0) {
      this.cacheCityTramsAndRoofTriggers();
    }
    if (!this.isPlayerFeetInsideTriggers(this.tramRoofTriggers)) {
      return;
    }
    this.onTramRoofContact();
  }

  private pollLampClimbFeetContact(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }
    if (this.lampTriggers.length === 0) {
      this.cacheLampTriggers();
    }
    const hitTrigger = this.findPlayerFeetTrigger(this.lampTriggers);
    if (!hitTrigger) {
      return;
    }
    hitTrigger.getWorldPosition(this.lampClimbFocusAnchor);
    this.hasLampClimbFocusAnchor = true;
    this.onLampClimbContact();
  }

  /**
   * Standing cherry canopy (TreeTrigger / TreeTriggger). Soft-loop when ordinance is
   * already active; otherwise mark a clean climb for unlock on mail delivery.
   */
  private pollTreeClimbFeetContact(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }
    if (this.treeTriggers.length === 0) {
      this.cacheTreeTriggers();
    }
    const hitTrigger = this.findStandingTreeClimbTrigger();
    if (!hitTrigger) {
      return;
    }
    hitTrigger.getWorldPosition(this.treeClimbFocusAnchor);
    this.hasTreeClimbFocusAnchor = true;

    if (
      this.noClimbingOnTheTreeOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.noClimbingOnTheTreeLoopTriggered
    ) {
      this.noClimbingOnTheTreeLoopTriggered = true;
      this.triggerBlockedNoClimbingOnTheTreeLoop();
      return;
    }

    // Unlock path: used the standing tree (not cut) — candidate for delivery picker.
    this.markRouteCandidate('noClimbingOnTheTree');
  }

  /**
   * Stand on Kiosk Wood that never rested on a road (e.g. hung on wires) → unlock
   * Dont remove this kiosk on the next mail delivery.
   */
  private pollKioskWoodPlatformUse(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }
    if (this.dontRemoveThisKioskOrdinanceActive) {
      return;
    }
    if (!this.isPlayerStandingOnCleanKioskWood()) {
      return;
    }
    this.markRouteCandidate('dontRemoveThisKiosk');
  }

  /** Prefer TreeTriggers whose cherry-tree parent is still visible (not axe-cut). */
  private findStandingTreeClimbTrigger(): ENGINE.SceneNode | null {
    if (!this.player || this.treeTriggers.length === 0) {
      return null;
    }
    const hit = this.findPlayerFeetTrigger(this.treeTriggers);
    if (!hit) {
      return null;
    }
    let current: THREE.Object3D | null = hit.parent;
    while (current) {
      if (current instanceof ENGINE.ModelMeshNode) {
        if (!current.visible) {
          return null;
        }
        break;
      }
      current = current.parent;
    }
    return hit;
  }

  /**
   * Walking utility-pole wires via any other platform (stacked crates, climbing poles, etc.)
   * — not tram roof, street-lamp tops, or the kanji sign.
   */
  private pollWireWalkFeetContact(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (this.wireTriggers.length === 0) {
      this.cacheWireTriggers();
    }
    if (this.standingUtilityPoles.length === 0) {
      this.cacheStandingUtilityPoles();
    }
    if (this.kanjiSignPlatforms.length === 0) {
      this.cacheKanjiSignPlatforms();
    }
    if (this.tramRoofTriggers.length === 0) {
      this.cacheCityTramsAndRoofTriggers();
    }
    if (this.lampTriggers.length === 0) {
      this.cacheLampTriggers();
    }
    if (this.treeTriggers.length === 0) {
      this.cacheTreeTriggers();
    }

    const onWires = this.isPlayerFeetInsideTriggers(this.wireTriggers)
      || this.isPlayerStandingOnStandingUtilityPoleWires();
    if (!onWires) {
      return;
    }

    // Allowed elevated routes that reach wire height — do not count as High Voltage.
    if (
      this.isPlayerFeetInsideTriggers(this.tramRoofTriggers)
      || this.isPlayerFeetInsideTriggers(this.lampTriggers)
      || this.isPlayerFeetInsideTriggers(this.treeTriggers)
      || this.isPlayerStandingOnKanjiSign()
      || this.isPlayerStandingOnKioskWood()
    ) {
      return;
    }

    this.onHighVoltageContact();
  }

  private onHighVoltageContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    if (
      this.highVoltageOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.highVoltageLoopTriggered
    ) {
      this.highVoltageLoopTriggered = true;
      this.triggerBlockedHighVoltageLoop();
      return;
    }

    if (!this.highVoltageOrdinanceActive) {
      this.markRouteCandidate('highVoltage');
    }
  }

  private pollCargoCrateOnRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      return;
    }
    this.ensureRestrictedRoadCaches();

    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!CARGO_CRATE_NAME.test(node.name ?? '')) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }

      if (!this.isPropRestingOnRestrictedRoadSurface(node)) {
        continue;
      }

      node.getWorldPosition(this.noCratesFocusAnchor);
      this.hasNoCratesFocusAnchor = true;
      this.onCargoCrateOnRoadContact();
      return;
    }
  }

  private pollParkBenchOnRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      return;
    }
    this.ensureRestrictedRoadCaches();

    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!PARK_BENCH_NAME.test(node.name ?? '')) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }

      if (!this.isPropRestingOnRestrictedRoadSurface(node)) {
        continue;
      }

      node.getWorldPosition(this.noBenchFocusAnchor);
      this.hasNoBenchFocusAnchor = true;
      this.onParkBenchOnRoadContact();
      return;
    }
  }

  private pollLogOnRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      return;
    }
    this.ensureRestrictedRoadCaches();

    // Prefab-spawned logs are named "Log" / "Log 2"… (see cherry-blossom-tree-drops).
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!this.isCarryableLogProp(node)) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }

      if (!this.isPropRestingOnRestrictedRoadSurface(node)) {
        continue;
      }

      node.getWorldPosition(this.noLogsFocusAnchor);
      this.hasNoLogsFocusAnchor = true;
      this.logsThatTouchedRoad.add(node);
      this.onLogOnRoadContact();
      return;
    }
  }

  private isCarryableLogProp(node: ENGINE.ModelMeshNode): boolean {
    if (CARRYABLE_LOG_NAME.test(node.name ?? '')) {
      return true;
    }
    return CARRYABLE_LOG_MODEL.test(node.modelUrl ?? '');
  }

  private pollWoodPlanksPropOnRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      return;
    }
    this.ensureRestrictedRoadCaches();

    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!this.isWoodPlanksRoadProp(node)) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }

      if (!this.isPropRestingOnRestrictedRoadSurface(node)) {
        continue;
      }

      if (this.isKioskWoodProp(node)) {
        this.kioskWoodThatTouchedRoad.add(node);
      }

      node.getWorldPosition(this.noWoodPlanksFocusAnchor);
      this.hasNoWoodPlanksFocusAnchor = true;
      this.onKioskWoodOnRoadContact();
      return;
    }
  }

  /** Kiosk Wood or Crate Planks Drop — both queue No Wood Planks on Roads. */
  private isWoodPlanksRoadProp(node: ENGINE.ModelMeshNode): boolean {
    const name = node.name ?? '';
    if (KIOSK_WOOD_NAME.test(name) || CRATE_PLANKS_DROP_NAME.test(name)) {
      return true;
    }
    const modelUrl = node.modelUrl ?? '';
    return KIOSK_WOOD_MODEL.test(modelUrl) || CRATE_PLANKS_DROP_MODEL.test(modelUrl);
  }

  private isKioskWoodProp(node: ENGINE.ModelMeshNode): boolean {
    if (KIOSK_WOOD_NAME.test(node.name ?? '')) {
      return true;
    }
    return KIOSK_WOOD_MODEL.test(node.modelUrl ?? '');
  }

  private pollScrapMetalOnRoadContact(): void {
    if (this.playableGraceRemaining > 0) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      return;
    }
    this.ensureRestrictedRoadCaches();

    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!this.isScrapMetalRoadProp(node)) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }

      if (!this.isPropRestingOnRestrictedRoadSurface(node)) {
        continue;
      }

      node.getWorldPosition(this.noScrapMetalsFocusAnchor);
      this.hasNoScrapMetalsFocusAnchor = true;
      this.onScrapMetalOnRoadContact(this.isFallenOrdinanceSignScrapProp(node));
      return;
    }
  }

  /**
   * Metal scraps from street lamps, park benches, guardrails, and fallen ordinance boards.
   */
  private isScrapMetalRoadProp(node: ENGINE.ModelMeshNode): boolean {
    if (this.isFallenOrdinanceSignScrapProp(node)) {
      return true;
    }
    const name = node.name ?? '';
    if (
      METAL_SCRAPT_NAME.test(name)
      || BENCH_SCRAPT_NAME.test(name)
      || GUARDRAIL_SCRAP_DROP_NAME.test(name)
    ) {
      return true;
    }
    return METAL_SCRAP_MODEL.test(node.modelUrl ?? '');
  }

  /** Fallen axe-dismantled ordinance boards (metal signposts usable as platforms). */
  private isFallenOrdinanceSignScrapProp(node: ENGINE.ModelMeshNode): boolean {
    const name = node.name ?? '';
    if (!FALLEN_ORDINANCE_SIGN_PLATFORM_NAME.test(name)) {
      return false;
    }
    if (FALLEN_UTILITY_POLE_PLATFORM_NAME.test(name)) {
      return false;
    }
    return FALLEN_ORDINANCE_SIGN_MODEL_PATH.test(node.modelUrl ?? '');
  }

  /**
   * Standing on a traffic cone while XZ is over a road, without feet touching asphalt.
   */
  private pollConePlatformRoadBypass(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    this.ensureRestrictedRoadCaches();
    if (this.platformTrafficCones.length === 0) {
      this.cachePlatformTrafficCones();
    }

    if (!this.isPlayerStandingOnTrafficCone()) {
      return;
    }

    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    const overRoad = this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.mainRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.leftSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.rightSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.tramTrackNodes);
    if (!overRoad) {
      return;
    }

    // Must not also be touching asphalt with feet (true road contact).
    if (
      this.isPlayerFeetOnRoadTiles(this.mainRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.leftSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.rightSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.tramTrackNodes)
    ) {
      return;
    }

    this.onDontRemoveTheConesContact('platform');
  }

  /**
   * Standing on a fallen (dismantled) utility pole while XZ is over a road,
   * without feet touching asphalt. Standing poles never match FALLEN names.
   */
  private pollFallenPolePlatformRoadBypass(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    this.ensureRestrictedRoadCaches();
    // Fallen poles spawn mid-day — refresh every poll.
    this.cachePlatformFallenUtilityPoles();

    if (!this.isPlayerStandingOnFallenUtilityPole()) {
      return;
    }

    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    const overRoad = this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.mainRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.leftSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.rightSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.tramTrackNodes);
    if (!overRoad) {
      return;
    }

    if (
      this.isPlayerFeetOnRoadTiles(this.mainRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.leftSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.rightSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.tramTrackNodes)
    ) {
      return;
    }

    this.onDontCutThisPoleContact();
  }

  /**
   * Standing on a fallen ordinance board while XZ is over a road,
   * without feet touching asphalt — unlock / soft-loop Do not remove the SIGNS.
   */
  private pollFallenOrdinanceSignPlatformRoadBypass(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    this.ensureRestrictedRoadCaches();
    // Fallen boards spawn mid-day — refresh every poll.
    this.cachePlatformFallenOrdinanceSigns();

    if (!this.isPlayerStandingOnFallenOrdinanceSign()) {
      return;
    }

    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    const overRoad = this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.mainRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.leftSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.rightSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.tramTrackNodes);
    if (!overRoad) {
      return;
    }

    if (
      this.isPlayerFeetOnRoadTiles(this.mainRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.leftSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.rightSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.tramTrackNodes)
    ) {
      return;
    }

    this.onDontRemoveTheSignsContact('platform');
  }

  /**
   * Standing on street-lamp Metal Scrapt over a road without the scrap itself
   * resting on asphalt — unlock / soft-loop Dont destroy the street lights.
   * If the scrap is on the road, pollScrapMetalOnRoadContact always handles
   * No Scrap Metals instead (never divert lamp scrap away from that ordinance).
   */
  private pollStreetLampScrapPlatformRoadBypass(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }

    this.ensureRestrictedRoadCaches();
    // Lamp scrap spawns mid-day — refresh every poll.
    this.cachePlatformStreetLampScraps();

    const scrap = this.findStreetLampScrapPlayerIsStandingOn();
    if (!scrap) {
      return;
    }
    // Scrap touching the road → No Scrap Metals only (not this ordinance).
    if (this.isPropRestingOnRestrictedRoadSurface(scrap)) {
      return;
    }

    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    const overRoad = this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.mainRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.leftSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.rightSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.tramTrackNodes);
    if (!overRoad) {
      return;
    }

    if (
      this.isPlayerFeetOnRoadTiles(this.mainRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.leftSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.rightSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.tramTrackNodes)
    ) {
      return;
    }

    this.onDontDestroyTheStreetLightsContact();
  }

  /**
   * After DontRemoveTheCones is active, picking up a cone = removing it → soft loop.
   * Wait until the player has actually been carrying it for a moment first.
   */
  private pollTrafficConePickupSoftLoop(deltaTime: number): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      this.conePickupCarryElapsed = 0;
      return;
    }
    if (!this.dontRemoveTheConesOrdinanceActive) {
      this.conePickupCarryElapsed = 0;
      return;
    }
    if (this.phase !== FlowPhase.AwaitingDelivery || this.dontRemoveTheConesLoopTriggered) {
      this.conePickupCarryElapsed = 0;
      return;
    }

    if (this.platformTrafficCones.length === 0) {
      this.cachePlatformTrafficCones();
    }

    let carryingCone = false;
    for (const cone of this.platformTrafficCones) {
      if (this.player.isCarryingObject(cone)) {
        carryingCone = true;
        break;
      }
    }

    if (!carryingCone) {
      this.conePickupCarryElapsed = 0;
      return;
    }

    this.conePickupCarryElapsed += deltaTime;
    if (this.conePickupCarryElapsed < this.conePickupSoftLoopDelaySec) {
      return;
    }

    this.conePickupCarryElapsed = 0;
    this.dontRemoveTheConesLoopTriggered = true;
    this.triggerBlockedDontRemoveTheConesLoop();
  }

  /**
   * After DontRemoveThisBush is active, wearing a bush again → soft loop.
   * Wait until the player has actually worn it for a moment first.
   */
  private pollBushWearSoftLoop(deltaTime: number): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      this.bushWearCarryElapsed = 0;
      return;
    }
    if (!this.dontRemoveThisBushOrdinanceActive) {
      this.bushWearCarryElapsed = 0;
      return;
    }
    if (this.phase !== FlowPhase.AwaitingDelivery || this.dontRemoveThisBushLoopTriggered) {
      this.bushWearCarryElapsed = 0;
      return;
    }

    if (!this.player.isWearingBush()) {
      this.bushWearCarryElapsed = 0;
      return;
    }

    this.bushWearCarryElapsed += deltaTime;
    if (this.bushWearCarryElapsed < this.bushWearSoftLoopDelaySec) {
      return;
    }

    this.bushWearCarryElapsed = 0;
    this.dontRemoveThisBushLoopTriggered = true;
    this.triggerBlockedDontRemoveThisBushLoop();
  }

  /**
   * First unlock: wearing a bush while feet are on a restricted road/track.
   */
  private pollBushWearOnRoadContact(): void {
    if (this.playableGraceRemaining > 0 || !this.player) {
      return;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return;
    }
    if (!this.player.isWearingBush()) {
      return;
    }

    this.ensureRestrictedRoadCaches();
    if (
      !this.isPlayerFeetOnRoadTiles(this.mainRoadNodes)
      && !this.isPlayerFeetOnRoadTiles(this.leftSideRoadNodes)
      && !this.isPlayerFeetOnRoadTiles(this.rightSideRoadNodes)
      && !this.isPlayerFeetOnRoadTiles(this.tramTrackNodes)
    ) {
      return;
    }

    this.onDontRemoveThisBushContact();
  }

  private isPlayerStandingOnTrafficCone(): boolean {
    if (!this.player) {
      return false;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    for (const cone of this.platformTrafficCones) {
      if (!cone.visible || !cone.parent) {
        continue;
      }
      // Carried cones follow the player — feet stay inside their AABB and would
      // falsely count as "standing on a cone" when walking over a road.
      if (this.player.isCarryingObject(cone)) {
        continue;
      }
      cone.updateMatrixWorld(true);
      this.tmpBounds.setFromObject(cone);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      this.tmpBounds.max.y += this.conePlatformTopYPad;
      if (this.tmpBounds.containsPoint(this.tmpPlayerPos)) {
        return true;
      }
    }
    return false;
  }

  private isPlayerStandingOnFallenUtilityPole(): boolean {
    if (!this.player) {
      return false;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    for (const pole of this.platformFallenUtilityPoles) {
      if (!pole.visible || !pole.parent) {
        continue;
      }
      pole.updateMatrixWorld(true);
      this.tmpBounds.setFromObject(pole);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      this.tmpBounds.max.y += this.fallenPolePlatformTopYPad;
      if (this.tmpBounds.containsPoint(this.tmpPlayerPos)) {
        return true;
      }
    }
    return false;
  }

  private isPlayerStandingOnFallenOrdinanceSign(): boolean {
    if (!this.player) {
      return false;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    for (const sign of this.platformFallenOrdinanceSigns) {
      if (!sign.visible || !sign.parent) {
        continue;
      }
      if (this.player.isCarryingObject(sign)) {
        continue;
      }
      sign.updateMatrixWorld(true);
      this.tmpBounds.setFromObject(sign);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      this.tmpBounds.max.y += this.fallenOrdinanceSignPlatformTopYPad;
      if (this.tmpBounds.containsPoint(this.tmpPlayerPos)) {
        return true;
      }
    }
    return false;
  }

  private isPlayerStandingOnStreetLampScrap(): boolean {
    return this.findStreetLampScrapPlayerIsStandingOn() !== null;
  }

  private findStreetLampScrapPlayerIsStandingOn(): ENGINE.ModelMeshNode | null {
    if (!this.player) {
      return null;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    for (const scrap of this.platformStreetLampScraps) {
      if (!scrap.visible || !scrap.parent) {
        continue;
      }
      if (this.player.isCarryingObject(scrap)) {
        continue;
      }
      scrap.updateMatrixWorld(true);
      this.tmpBounds.setFromObject(scrap);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      this.tmpBounds.max.y += this.streetLampScrapPlatformTopYPad;
      if (this.tmpBounds.containsPoint(this.tmpPlayerPos)) {
        return scrap;
      }
    }
    return null;
  }

  /** Standing on a fallen / upright Kanji Sign mesh (allowed wire-height route). */
  private isPlayerStandingOnKanjiSign(): boolean {
    if (!this.player) {
      return false;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    for (const sign of this.kanjiSignPlatforms) {
      if (!sign.visible || !sign.parent) {
        continue;
      }
      sign.updateMatrixWorld(true);
      this.tmpBounds.setFromObject(sign);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      this.tmpBounds.max.y += this.elevatedPlatformTopYPad;
      if (this.tmpBounds.containsPoint(this.tmpPlayerPos)) {
        return true;
      }
    }
    return false;
  }

  /** Any trail-map Kiosk Wood underfoot (High Voltage bypass). */
  private isPlayerStandingOnKioskWood(): boolean {
    return this.findStoodOnKioskWood() !== null;
  }

  /** Kiosk Wood underfoot that has never rested on a restricted road. */
  private isPlayerStandingOnCleanKioskWood(): boolean {
    const wood = this.findStoodOnKioskWood();
    return wood !== null && !this.kioskWoodThatTouchedRoad.has(wood);
  }

  private findStoodOnKioskWood(): ENGINE.ModelMeshNode | null {
    if (!this.player) {
      return null;
    }
    const world = this.getWorld();
    if (!world) {
      return null;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!this.isKioskWoodProp(node) || !node.visible || !node.parent) {
        continue;
      }
      if (this.player.isCarryingObject(node)) {
        continue;
      }
      node.updateMatrixWorld(true);
      this.tmpBounds.setFromObject(node);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      this.tmpBounds.max.y += this.kioskWoodPlatformTopYPad;
      if (this.tmpBounds.containsPoint(this.tmpPlayerPos)) {
        return node;
      }
    }
    return null;
  }

  /** Standing on the upper crossarm/wire zone of a standing utility pole. */
  private isPlayerStandingOnStandingUtilityPoleWires(): boolean {
    if (!this.player) {
      return false;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    for (const pole of this.standingUtilityPoles) {
      if (!pole.visible || !pole.parent) {
        continue;
      }
      pole.updateMatrixWorld(true);
      this.tmpBounds.setFromObject(pole);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      const wireFloorY = THREE.MathUtils.lerp(
        this.tmpBounds.min.y,
        this.tmpBounds.max.y,
        this.utilityPoleWireHeightFrac,
      );
      if (this.tmpPlayerPos.y < wireFloorY) {
        continue;
      }
      this.tmpBounds.min.y = wireFloorY;
      this.tmpBounds.max.y += this.elevatedPlatformTopYPad;
      if (this.tmpBounds.containsPoint(this.tmpPlayerPos)) {
        return true;
      }
    }
    return false;
  }

  private ensureRestrictedRoadCaches(): void {
    if (this.mainRoadNodes.length === 0) {
      this.cacheMainRoads();
    }
    if (this.leftSideRoadNodes.length === 0) {
      this.cacheLeftSideRoads();
    }
    if (this.rightSideRoadNodes.length === 0) {
      this.cacheRightSideRoads();
    }
    if (this.tramTrackNodes.length === 0) {
      this.cacheTramTracks();
    }
  }

  private isPlayerFeetOnRoadTiles(roads: ENGINE.SceneNode[]): boolean {
    if (!this.player) {
      return false;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;
    return this.isPointOnRoadTiles(
      this.tmpPlayerPos,
      roads,
      this.mainRoadFeetWorldYSlop,
      this.mainRoadFeetWorldYSlop,
    );
  }

  /**
   * Exact prop AABB footprint on the road: sample the bottom face only, require
   * near-contact Y. Mid-air throws are ignored via vertical speed only so a single
   * sliding/settling log still counts. Road tile XZ size is unchanged.
   */
  private isPropRestingOnRestrictedRoadSurface(prop: ENGINE.ModelMeshNode): boolean {
    prop.updateMatrixWorld(true);
    this.tmpBounds.setFromObject(prop);
    if (this.tmpBounds.isEmpty()) {
      return false;
    }

    const minX = this.tmpBounds.min.x;
    const maxX = this.tmpBounds.max.x;
    const minZ = this.tmpBounds.min.z;
    const maxZ = this.tmpBounds.max.z;
    const bottomY = this.tmpBounds.min.y;

    // Estimate vertical speed from AABB bottom motion — do not read Rapier linvel here.
    const prevBottomY = this.propPrevBottomY.get(prop.uuid);
    this.propPrevBottomY.set(prop.uuid, bottomY);
    if (prevBottomY === undefined) {
      return false;
    }
    const verticalSpeed = Math.abs((bottomY - prevBottomY) / this.lastPrePhysicsDeltaTime);
    if (verticalSpeed > this.propRoadMaxVerticalSpeed) {
      return false;
    }

    // Denser grid so long thin props (logs) still register from a single piece.
    for (let ix = 0; ix < 5; ix += 1) {
      for (let iz = 0; iz < 5; iz += 1) {
        this.tmpHitPoint.set(
          THREE.MathUtils.lerp(minX, maxX, ix / 4),
          bottomY,
          THREE.MathUtils.lerp(minZ, maxZ, iz / 4),
        );
        if (this.isPropSampleOnRestrictedRoads(this.tmpHitPoint)) {
          return true;
        }
      }
    }
    return false;
  }

  private isPropSampleOnRestrictedRoads(worldPoint: THREE.Vector3): boolean {
    return this.isPointOnRoadTiles(
      worldPoint,
      this.mainRoadNodes,
      this.crateRoadContactYSlop,
      this.crateRoadContactYSlop,
    )
      || this.isPointOnRoadTiles(
        worldPoint,
        this.leftSideRoadNodes,
        this.crateRoadContactYSlop,
        this.crateRoadContactYSlop,
      )
      || this.isPointOnRoadTiles(
        worldPoint,
        this.rightSideRoadNodes,
        this.crateRoadContactYSlop,
        this.crateRoadContactYSlop,
      )
      || this.isPointOnRoadTiles(
        worldPoint,
        this.tramTrackNodes,
        this.crateRoadContactYSlop,
        this.crateRoadContactYSlop,
      );
  }

  private isPointOnRoadTiles(
    worldPoint: THREE.Vector3,
    roads: ENGINE.SceneNode[],
    yBelow: number,
    yAbove: number,
  ): boolean {
    for (const road of roads) {
      this.tmpFeetLocal.copy(worldPoint);
      road.worldToLocal(this.tmpFeetLocal);
      if (
        Math.abs(this.tmpFeetLocal.x) > this.mainRoadHalfExtent
        || Math.abs(this.tmpFeetLocal.z) > this.mainRoadHalfExtent
      ) {
        continue;
      }
      road.getWorldPosition(this.tmpRoadWorldPos);
      const dy = worldPoint.y - this.tmpRoadWorldPos.y;
      if (dy >= -Math.abs(yBelow) && dy <= Math.abs(yAbove)) {
        return true;
      }
    }
    return false;
  }

  /** Same road XZ footprint as feet/props, ignoring height (cone platform over asphalt). */
  private isPointXZOnRoadTiles(worldPoint: THREE.Vector3, roads: ENGINE.SceneNode[]): boolean {
    for (const road of roads) {
      this.tmpFeetLocal.copy(worldPoint);
      road.worldToLocal(this.tmpFeetLocal);
      if (
        Math.abs(this.tmpFeetLocal.x) <= this.mainRoadHalfExtent
        && Math.abs(this.tmpFeetLocal.z) <= this.mainRoadHalfExtent
      ) {
        return true;
      }
    }
    return false;
  }

  /**
   * Vehicle / lamp step volumes use each trigger's local unit box (±0.5).
   * Author scale/position on TramTrigger / LampTrigger / CarRoofTrigger is respected via worldToLocal.
   */
  private isPlayerFeetInsideTriggers(triggers: ENGINE.SceneNode[]): boolean {
    return this.findPlayerFeetTrigger(triggers) !== null;
  }

  private findPlayerFeetTrigger(triggers: ENGINE.SceneNode[]): ENGINE.SceneNode | null {
    if (!this.player) {
      return null;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;
    for (const trigger of triggers) {
      trigger.updateMatrixWorld(true);
      this.tmpFeetLocal.copy(this.tmpPlayerPos);
      trigger.worldToLocal(this.tmpFeetLocal);
      if (
        Math.abs(this.tmpFeetLocal.x) <= 0.5
        && Math.abs(this.tmpFeetLocal.y) <= 0.5
        && Math.abs(this.tmpFeetLocal.z) <= 0.5
      ) {
        return trigger;
      }
    }
    return null;
  }

  private cacheMainRoads(): void {
    this.mainRoadNodes.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getRootNodes()) {
      if (MAIN_ROAD_NAME.test(node.name ?? '')) {
        this.mainRoadNodes.push(node);
      }
    }
  }

  private cacheLeftSideRoads(): void {
    this.leftSideRoadNodes.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getRootNodes()) {
      if (LEFT_SIDE_ROAD_NAME.test(node.name ?? '')) {
        this.leftSideRoadNodes.push(node);
      }
    }
  }

  private cacheRightSideRoads(): void {
    this.rightSideRoadNodes.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getRootNodes()) {
      if (RIGHT_SIDE_ROAD_NAME.test(node.name ?? '')) {
        this.rightSideRoadNodes.push(node);
      }
    }
  }

  private cacheTramTracks(): void {
    this.tramTrackNodes.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getRootNodes()) {
      if (TRAM_TRACK_NAME.test(node.name ?? '')) {
        this.tramTrackNodes.push(node);
      }
    }
  }

  private cacheClimbCarsAndRoofTriggers(): void {
    this.climbCars.length = 0;
    this.carRoofTriggers.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!CLIMB_CAR_NAME.test(node.name ?? '')) {
        continue;
      }
      this.climbCars.push(node);
      this.carRoofTriggers.push(
        this.fitVehicleTopStepTrigger(node, CAR_ROOF_TRIGGER_NAME, 'CarRoofTrigger', {
          bottomHeightFrac: 0.38,
          xzFrac: 0.94,
        }),
      );
    }
  }

  private cacheCityTramsAndRoofTriggers(): void {
    this.cityTrams.length = 0;
    this.tramRoofTriggers.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!CITY_TRAM_NAME.test(node.name ?? '')) {
        continue;
      }
      this.cityTrams.push(node);
      // Author-scaled TramTrigger mesh only — never rewrite position/scale.
      const authored = this.findChildTriggerNode(node, TRAM_TRIGGER_NAME);
      if (!authored) {
        continue;
      }
      // Visibility / collision only — leave transform entirely to the editor.
      authored.visible = false;
      if (authored instanceof ENGINE.PrimitiveNode) {
        const physics = authored.getPhysicsOptions();
        if (physics.enabled !== false) {
          authored.overridePhysicsOptions({ enabled: false });
        }
      }
      this.tramRoofTriggers.push(authored);
    }
  }

  private cacheLampTriggers(): void {
    this.lampTriggers.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.MeshNode)) {
      if (!LAMP_TRIGGER_NAME.test(node.name ?? '')) {
        continue;
      }
      // Visibility / collision only — leave transform entirely to the editor.
      node.visible = false;
      const physics = node.getPhysicsOptions();
      if (physics.enabled !== false) {
        node.overridePhysicsOptions({ enabled: false });
      }
      this.lampTriggers.push(node);
    }
  }

  private cacheTreeTriggers(): void {
    this.treeTriggers.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.MeshNode)) {
      if (!TREE_TRIGGER_NAME.test(node.name ?? '')) {
        continue;
      }
      node.visible = false;
      const physics = node.getPhysicsOptions();
      if (physics.enabled !== false) {
        node.overridePhysicsOptions({ enabled: false });
      }
      this.treeTriggers.push(node);
    }
  }

  private cacheWireTriggers(): void {
    this.wireTriggers.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.MeshNode)) {
      if (!WIRE_TRIGGER_NAME.test(node.name ?? '')) {
        continue;
      }
      node.visible = false;
      const physics = node.getPhysicsOptions();
      if (physics.enabled !== false) {
        node.overridePhysicsOptions({ enabled: false });
      }
      this.wireTriggers.push(node);
    }
  }

  private cacheStandingUtilityPoles(): void {
    this.standingUtilityPoles.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!STANDING_UTILITY_POLE_NAME.test(node.name ?? '')) {
        continue;
      }
      this.standingUtilityPoles.push(node);
    }
  }

  private cacheKanjiSignPlatforms(): void {
    this.kanjiSignPlatforms.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!KANJI_SIGN_PLATFORM_NAME.test(node.name ?? '')) {
        continue;
      }
      this.kanjiSignPlatforms.push(node);
    }
  }

  private cacheStreetLightsClimbOrdinances(): void {
    this.streetLightsClimbOrdinances.length = 0;
    this.streetLightsClimb = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!STREET_LIGHTS_CLIMB_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.streetLightsClimbOrdinances.push(node);
    }
    this.streetLightsClimb = this.streetLightsClimbOrdinances.find(
      (node) => STREET_LIGHTS_CLIMB_NAME.test(node.name ?? ''),
    ) ?? this.streetLightsClimbOrdinances[0] ?? null;
  }

  /** Prefer the Street Lights Climb board nearest the last climbed lamp (else player). */
  private findNearestStreetLightsClimb(): ENGINE.ModelMeshNode | null {
    if (this.streetLightsClimbOrdinances.length === 0) {
      this.cacheStreetLightsClimbOrdinances();
    }
    if (this.streetLightsClimbOrdinances.length === 0) {
      return this.streetLightsClimb;
    }

    if (this.hasLampClimbFocusAnchor) {
      this.tmpPlayerPos.copy(this.lampClimbFocusAnchor);
    } else if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.streetLightsClimb;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.streetLightsClimbOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.streetLightsClimb;
  }

  private cacheStreetLightsDestroyOrdinances(): void {
    this.streetLightsDestroyOrdinances.length = 0;
    this.streetLightsDestroy = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!STREET_LIGHTS_DESTROY_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.streetLightsDestroyOrdinances.push(node);
    }
    this.streetLightsDestroy = this.streetLightsDestroyOrdinances.find(
      (node) => STREET_LIGHTS_DESTROY_NAME.test(node.name ?? ''),
    ) ?? this.streetLightsDestroyOrdinances[0] ?? null;
  }

  private findNearestStreetLightsDestroy(): ENGINE.ModelMeshNode | null {
    if (this.streetLightsDestroyOrdinances.length === 0) {
      this.cacheStreetLightsDestroyOrdinances();
    }
    if (this.streetLightsDestroyOrdinances.length === 0) {
      return this.streetLightsDestroy;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.streetLightsDestroy;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.streetLightsDestroyOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.streetLightsDestroy;
  }

  private cacheDontFeedTheCatOrdinances(): void {
    this.dontFeedTheCatOrdinances.length = 0;
    this.dontFeedTheCat = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!DONT_FEED_THE_CAT_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.dontFeedTheCatOrdinances.push(node);
    }
    this.dontFeedTheCat = this.dontFeedTheCatOrdinances.find(
      (node) => DONT_FEED_THE_CAT_NAME.test(node.name ?? ''),
    ) ?? this.dontFeedTheCatOrdinances[0] ?? null;
  }

  private findNearestDontFeedTheCat(): ENGINE.ModelMeshNode | null {
    if (this.dontFeedTheCatOrdinances.length === 0) {
      this.cacheDontFeedTheCatOrdinances();
    }
    if (this.dontFeedTheCatOrdinances.length === 0) {
      return this.dontFeedTheCat;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.dontFeedTheCat;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.dontFeedTheCatOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.dontFeedTheCat;
  }

  private cacheNoCatsOnStreetsOrdinances(): void {
    this.noCatsOnStreetsOrdinances.length = 0;
    this.noCatsOnStreets = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!NO_CATS_ON_STREETS_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noCatsOnStreetsOrdinances.push(node);
    }
    this.noCatsOnStreets = this.noCatsOnStreetsOrdinances.find(
      (node) => NO_CATS_ON_STREETS_NAME.test(node.name ?? ''),
    ) ?? this.noCatsOnStreetsOrdinances[0] ?? null;
  }

  private findNearestNoCatsOnStreets(): ENGINE.ModelMeshNode | null {
    if (this.noCatsOnStreetsOrdinances.length === 0) {
      this.cacheNoCatsOnStreetsOrdinances();
    }
    if (this.noCatsOnStreetsOrdinances.length === 0) {
      return this.noCatsOnStreets;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.noCatsOnStreets;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noCatsOnStreetsOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.noCatsOnStreets;
  }

  private cacheNoCratesOnRoadsOrdinances(): void {
    this.noCratesOnRoadsOrdinances.length = 0;
    this.noCratesOnRoads = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!NO_CRATES_ON_ROADS_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noCratesOnRoadsOrdinances.push(node);
    }
    this.noCratesOnRoads = this.noCratesOnRoadsOrdinances.find(
      (node) => NO_CRATES_ON_ROADS_NAME.test(node.name ?? ''),
    ) ?? this.noCratesOnRoadsOrdinances[0] ?? null;
  }

  /** Prefer the Crates board nearest the offending cargo crate (else player). */
  private findNearestNoCratesOnRoads(): ENGINE.ModelMeshNode | null {
    if (this.noCratesOnRoadsOrdinances.length === 0) {
      this.cacheNoCratesOnRoadsOrdinances();
    }
    if (this.noCratesOnRoadsOrdinances.length === 0) {
      return this.noCratesOnRoads;
    }

    if (this.hasNoCratesFocusAnchor) {
      this.tmpPlayerPos.copy(this.noCratesFocusAnchor);
    } else if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.noCratesOnRoads;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noCratesOnRoadsOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.noCratesOnRoads;
  }

  private cacheNoBenchOnRoadsOrdinances(): void {
    this.noBenchOnRoadsOrdinances.length = 0;
    this.noBenchOnRoads = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!NO_BENCH_ON_ROADS_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noBenchOnRoadsOrdinances.push(node);
    }
    this.noBenchOnRoads = this.noBenchOnRoadsOrdinances.find(
      (node) => NO_BENCH_ON_ROADS_NAME.test(node.name ?? ''),
    ) ?? this.noBenchOnRoadsOrdinances[0] ?? null;
  }

  /** Prefer the Bench board nearest the offending park bench (else player). */
  private findNearestNoBenchOnRoads(): ENGINE.ModelMeshNode | null {
    if (this.noBenchOnRoadsOrdinances.length === 0) {
      this.cacheNoBenchOnRoadsOrdinances();
    }
    if (this.noBenchOnRoadsOrdinances.length === 0) {
      return this.noBenchOnRoads;
    }

    if (this.hasNoBenchFocusAnchor) {
      this.tmpPlayerPos.copy(this.noBenchFocusAnchor);
    } else if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.noBenchOnRoads;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noBenchOnRoadsOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.noBenchOnRoads;
  }

  private cacheNoLogsOnRoadsOrdinances(): void {
    this.noLogsOnRoadsOrdinances.length = 0;
    this.noLogsOnRoads = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!NO_LOGS_ON_ROADS_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noLogsOnRoadsOrdinances.push(node);
    }
    this.noLogsOnRoads = this.noLogsOnRoadsOrdinances.find(
      (node) => NO_LOGS_ON_ROADS_NAME.test(node.name ?? ''),
    ) ?? this.noLogsOnRoadsOrdinances[0] ?? null;
  }

  /** Prefer the Logs board nearest the offending log (else player). */
  private findNearestNoLogsOnRoads(): ENGINE.ModelMeshNode | null {
    if (this.noLogsOnRoadsOrdinances.length === 0) {
      this.cacheNoLogsOnRoadsOrdinances();
    }
    if (this.noLogsOnRoadsOrdinances.length === 0) {
      return this.noLogsOnRoads;
    }

    if (this.hasNoLogsFocusAnchor) {
      this.tmpPlayerPos.copy(this.noLogsFocusAnchor);
    } else if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.noLogsOnRoads;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noLogsOnRoadsOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.noLogsOnRoads;
  }

  private cacheNoWoodPlanksOnRoadsOrdinances(): void {
    this.noWoodPlanksOnRoadsOrdinances.length = 0;
    this.noWoodPlanksOnRoads = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!NO_WOOD_PLANKS_ON_ROADS_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noWoodPlanksOnRoadsOrdinances.push(node);
    }
    this.noWoodPlanksOnRoads = this.noWoodPlanksOnRoadsOrdinances.find(
      (node) => NO_WOOD_PLANKS_ON_ROADS_NAME.test(node.name ?? ''),
    ) ?? this.noWoodPlanksOnRoadsOrdinances[0] ?? null;
  }

  /** Prefer the Wood Planks board nearest the offending kiosk wood (else player). */
  private findNearestNoWoodPlanksOnRoads(): ENGINE.ModelMeshNode | null {
    if (this.noWoodPlanksOnRoadsOrdinances.length === 0) {
      this.cacheNoWoodPlanksOnRoadsOrdinances();
    }
    if (this.noWoodPlanksOnRoadsOrdinances.length === 0) {
      return this.noWoodPlanksOnRoads;
    }

    if (this.hasNoWoodPlanksFocusAnchor) {
      this.tmpPlayerPos.copy(this.noWoodPlanksFocusAnchor);
    } else if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.noWoodPlanksOnRoads;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noWoodPlanksOnRoadsOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.noWoodPlanksOnRoads;
  }

  private cacheDontRemoveTheConesOrdinances(): void {
    this.dontRemoveTheConesOrdinances.length = 0;
    this.dontRemoveTheCones = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!DONT_REMOVE_THE_CONES_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.dontRemoveTheConesOrdinances.push(node);
    }
    this.dontRemoveTheCones = this.dontRemoveTheConesOrdinances.find(
      (node) => DONT_REMOVE_THE_CONES_NAME.test(node.name ?? ''),
    ) ?? this.dontRemoveTheConesOrdinances[0] ?? null;
  }

  private findNearestDontRemoveTheCones(): ENGINE.ModelMeshNode | null {
    if (this.dontRemoveTheConesOrdinances.length === 0) {
      this.cacheDontRemoveTheConesOrdinances();
    }
    if (this.dontRemoveTheConesOrdinances.length === 0) {
      return this.dontRemoveTheCones;
    }
    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.dontRemoveTheCones;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.dontRemoveTheConesOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.dontRemoveTheCones;
  }

  private cacheNoScrapMetalsOnRoadsOrdinances(): void {
    this.noScrapMetalsOnRoadsOrdinances.length = 0;
    this.noScrapMetalsOnRoads = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!NO_SCRAP_METALS_ON_ROADS_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noScrapMetalsOnRoadsOrdinances.push(node);
    }
    this.noScrapMetalsOnRoads = this.noScrapMetalsOnRoadsOrdinances.find(
      (node) => NO_SCRAP_METALS_ON_ROADS_NAME.test(node.name ?? ''),
    ) ?? this.noScrapMetalsOnRoadsOrdinances[0] ?? null;
  }

  private findNearestNoScrapMetalsOnRoads(): ENGINE.ModelMeshNode | null {
    if (this.noScrapMetalsOnRoadsOrdinances.length === 0) {
      this.cacheNoScrapMetalsOnRoadsOrdinances();
    }
    if (this.noScrapMetalsOnRoadsOrdinances.length === 0) {
      return this.noScrapMetalsOnRoads;
    }

    if (this.hasNoScrapMetalsFocusAnchor) {
      this.tmpPlayerPos.copy(this.noScrapMetalsFocusAnchor);
    } else if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.noScrapMetalsOnRoads;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noScrapMetalsOnRoadsOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.noScrapMetalsOnRoads;
  }

  private cacheDontRemoveThisBushOrdinances(): void {
    this.dontRemoveThisBushOrdinances.length = 0;
    this.dontRemoveThisBush = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!DONT_REMOVE_THIS_BUSH_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.dontRemoveThisBushOrdinances.push(node);
    }
    this.dontRemoveThisBush = this.dontRemoveThisBushOrdinances.find(
      (node) => DONT_REMOVE_THIS_BUSH_NAME.test(node.name ?? ''),
    ) ?? this.dontRemoveThisBushOrdinances[0] ?? null;
  }

  private findNearestDontRemoveThisBush(): ENGINE.ModelMeshNode | null {
    if (this.dontRemoveThisBushOrdinances.length === 0) {
      this.cacheDontRemoveThisBushOrdinances();
    }
    if (this.dontRemoveThisBushOrdinances.length === 0) {
      return this.dontRemoveThisBush;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.dontRemoveThisBush;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.dontRemoveThisBushOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.dontRemoveThisBush;
  }

  private cacheDontRemoveThisKioskOrdinances(): void {
    this.dontRemoveThisKioskOrdinances.length = 0;
    this.dontRemoveThisKiosk = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!DONT_REMOVE_THIS_KIOSK_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.dontRemoveThisKioskOrdinances.push(node);
    }
    this.dontRemoveThisKiosk = this.dontRemoveThisKioskOrdinances.find(
      (node) => DONT_REMOVE_THIS_KIOSK_NAME.test(node.name ?? ''),
    ) ?? this.dontRemoveThisKioskOrdinances[0] ?? null;
  }

  private findNearestDontRemoveThisKiosk(): ENGINE.ModelMeshNode | null {
    if (this.dontRemoveThisKioskOrdinances.length === 0) {
      this.cacheDontRemoveThisKioskOrdinances();
    }
    if (this.dontRemoveThisKioskOrdinances.length === 0) {
      return this.dontRemoveThisKiosk;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.dontRemoveThisKiosk;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.dontRemoveThisKioskOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.dontRemoveThisKiosk;
  }

  private cacheDontCutThisPoleOrdinances(): void {
    this.dontCutThisPoleOrdinances.length = 0;
    this.dontCutThisPole = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!DONT_CUT_THIS_POLE_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.dontCutThisPoleOrdinances.push(node);
    }
    this.dontCutThisPole = this.dontCutThisPoleOrdinances.find(
      (node) => DONT_CUT_THIS_POLE_NAME.test(node.name ?? ''),
    ) ?? this.dontCutThisPoleOrdinances[0] ?? null;
  }

  private findNearestDontCutThisPole(): ENGINE.ModelMeshNode | null {
    if (this.dontCutThisPoleOrdinances.length === 0) {
      this.cacheDontCutThisPoleOrdinances();
    }
    if (this.dontCutThisPoleOrdinances.length === 0) {
      return this.dontCutThisPole;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.dontCutThisPole;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.dontCutThisPoleOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.dontCutThisPole;
  }

  private cacheDoNotDestroyThisSignOrdinances(): void {
    this.doNotDestroyThisSignOrdinances.length = 0;
    this.doNotDestroyThisSign = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!DO_NOT_DESTROY_THIS_SIGN_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.doNotDestroyThisSignOrdinances.push(node);
    }
    this.doNotDestroyThisSign = this.doNotDestroyThisSignOrdinances.find(
      (node) => DO_NOT_DESTROY_THIS_SIGN_NAME.test(node.name ?? ''),
    ) ?? this.doNotDestroyThisSignOrdinances[0] ?? null;
  }

  private findNearestDoNotDestroyThisSign(): ENGINE.ModelMeshNode | null {
    if (this.doNotDestroyThisSignOrdinances.length === 0) {
      this.cacheDoNotDestroyThisSignOrdinances();
    }
    if (this.doNotDestroyThisSignOrdinances.length === 0) {
      return this.doNotDestroyThisSign;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.doNotDestroyThisSign;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.doNotDestroyThisSignOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.doNotDestroyThisSign;
  }

  private cacheDontHitTheFireHydrantOrdinances(): void {
    this.dontHitTheFireHydrantOrdinances.length = 0;
    this.dontHitTheFireHydrant = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!DONT_HIT_THE_FIRE_HYDRANT_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.dontHitTheFireHydrantOrdinances.push(node);
    }
    this.dontHitTheFireHydrant = this.dontHitTheFireHydrantOrdinances.find(
      (node) => DONT_HIT_THE_FIRE_HYDRANT_NAME.test(node.name ?? ''),
    ) ?? this.dontHitTheFireHydrantOrdinances[0] ?? null;
  }

  private findNearestDontHitTheFireHydrant(): ENGINE.ModelMeshNode | null {
    if (this.dontHitTheFireHydrantOrdinances.length === 0) {
      this.cacheDontHitTheFireHydrantOrdinances();
    }
    if (this.dontHitTheFireHydrantOrdinances.length === 0) {
      return this.dontHitTheFireHydrant;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.dontHitTheFireHydrant;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.dontHitTheFireHydrantOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.dontHitTheFireHydrant;
  }

  private cacheHighVoltageOrdinances(): void {
    this.highVoltageOrdinances.length = 0;
    this.highVoltage = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!HIGH_VOLTAGE_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.highVoltageOrdinances.push(node);
    }
    this.highVoltage = this.highVoltageOrdinances.find(
      (node) => HIGH_VOLTAGE_NAME.test(node.name ?? ''),
    ) ?? this.highVoltageOrdinances[0] ?? null;
  }

  private findNearestHighVoltage(): ENGINE.ModelMeshNode | null {
    if (this.highVoltageOrdinances.length === 0) {
      this.cacheHighVoltageOrdinances();
    }
    if (this.highVoltageOrdinances.length === 0) {
      return this.highVoltage;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.highVoltage;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.highVoltageOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.highVoltage;
  }

  private cacheNoCuttingOfTreesOrdinances(): void {
    this.noCuttingOfTreesOrdinances.length = 0;
    this.noCuttingOfTrees = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!NO_CUTTING_OF_TREES_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noCuttingOfTreesOrdinances.push(node);
    }
    this.noCuttingOfTrees = this.noCuttingOfTreesOrdinances.find(
      (node) => NO_CUTTING_OF_TREES_NAME.test(node.name ?? ''),
    ) ?? this.noCuttingOfTreesOrdinances[0] ?? null;
  }

  private findNearestNoCuttingOfTrees(): ENGINE.ModelMeshNode | null {
    if (this.noCuttingOfTreesOrdinances.length === 0) {
      this.cacheNoCuttingOfTreesOrdinances();
    }
    if (this.noCuttingOfTreesOrdinances.length === 0) {
      return this.noCuttingOfTrees;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.noCuttingOfTrees;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noCuttingOfTreesOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.noCuttingOfTrees;
  }

  private cacheNoClimbingOnTheTreeOrdinances(): void {
    this.noClimbingOnTheTreeOrdinances.length = 0;
    this.noClimbingOnTheTree = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!NO_CLIMBING_ON_THE_TREE_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noClimbingOnTheTreeOrdinances.push(node);
    }
    this.noClimbingOnTheTree = this.noClimbingOnTheTreeOrdinances.find(
      (node) => NO_CLIMBING_ON_THE_TREE_NAME.test(node.name ?? ''),
    ) ?? this.noClimbingOnTheTreeOrdinances[0] ?? null;
  }

  private findNearestNoClimbingOnTheTree(): ENGINE.ModelMeshNode | null {
    if (this.noClimbingOnTheTreeOrdinances.length === 0) {
      this.cacheNoClimbingOnTheTreeOrdinances();
    }
    if (this.noClimbingOnTheTreeOrdinances.length === 0) {
      return this.noClimbingOnTheTree;
    }

    if (this.hasTreeClimbFocusAnchor) {
      this.tmpPlayerPos.copy(this.treeClimbFocusAnchor);
    } else if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.noClimbingOnTheTree;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noClimbingOnTheTreeOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.noClimbingOnTheTree;
  }

  private cacheDoNotRemoveTheSignsOrdinances(): void {
    this.doNotRemoveTheSignsOrdinances.length = 0;
    this.doNotRemoveTheSigns = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!DO_NOT_REMOVE_THE_SIGNS_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.doNotRemoveTheSignsOrdinances.push(node);
    }
    this.doNotRemoveTheSigns = this.doNotRemoveTheSignsOrdinances.find(
      (node) => DO_NOT_REMOVE_THE_SIGNS_NAME.test(node.name ?? ''),
    ) ?? this.doNotRemoveTheSignsOrdinances[0] ?? null;
  }

  private findNearestDoNotRemoveTheSigns(): ENGINE.ModelMeshNode | null {
    if (this.doNotRemoveTheSignsOrdinances.length === 0) {
      this.cacheDoNotRemoveTheSignsOrdinances();
    }
    if (this.doNotRemoveTheSignsOrdinances.length === 0) {
      return this.doNotRemoveTheSigns;
    }

    if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.doNotRemoveTheSigns;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.doNotRemoveTheSignsOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.doNotRemoveTheSigns;
  }

  private cachePlatformTrafficCones(): void {
    this.platformTrafficCones.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!TRAFFIC_CONE_PLATFORM_NAME.test(node.name ?? '')) {
        continue;
      }
      this.platformTrafficCones.push(node);
    }
  }

  private cachePlatformFallenUtilityPoles(): void {
    this.platformFallenUtilityPoles.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!FALLEN_UTILITY_POLE_PLATFORM_NAME.test(node.name ?? '')) {
        continue;
      }
      this.platformFallenUtilityPoles.push(node);
    }
  }

  private cachePlatformFallenOrdinanceSigns(): void {
    this.platformFallenOrdinanceSigns.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      const name = node.name ?? '';
      if (!FALLEN_ORDINANCE_SIGN_PLATFORM_NAME.test(name)) {
        continue;
      }
      // Exclude utility-pole fallen meshes (same "Fallen Mesh" suffix).
      if (FALLEN_UTILITY_POLE_PLATFORM_NAME.test(name)) {
        continue;
      }
      if (!FALLEN_ORDINANCE_SIGN_MODEL_PATH.test(node.modelUrl ?? '')) {
        continue;
      }
      this.platformFallenOrdinanceSigns.push(node);
    }
  }

  private cachePlatformStreetLampScraps(): void {
    this.platformStreetLampScraps.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (!STREET_LAMP_SCRAP_PLATFORM_NAME.test(node.name ?? '')) {
        continue;
      }
      this.platformStreetLampScraps.push(node);
    }
  }

  private findChildTriggerNode(
    parent: ENGINE.SceneNode,
    namePattern: RegExp,
  ): ENGINE.SceneNode | null {
    for (const child of parent.children) {
      if (child instanceof ENGINE.SceneNode && namePattern.test(child.name ?? '')) {
        return child;
      }
    }
    return null;
  }

  /**
   * Snap / create an invisible step volume on a climbable vehicle.
   * `bottomHeightFrac` is where the volume starts relative to the vehicle AABB height
   * (higher = more roof-only; lower also covers hood / front surfaces).
   */
  private fitVehicleTopStepTrigger(
    vehicle: ENGINE.ModelMeshNode,
    triggerNamePattern: RegExp,
    createName: string,
    options: {
      bottomHeightFrac: number;
      xzFrac?: number;
      topPad?: number;
      minHeight?: number;
    },
  ): ENGINE.SceneNode {
    let trigger: ENGINE.SceneNode | null = null;
    for (const child of vehicle.children) {
      if (child instanceof ENGINE.SceneNode && triggerNamePattern.test(child.name ?? '')) {
        trigger = child;
        break;
      }
    }
    if (!trigger) {
      trigger = ENGINE.SceneNode.create({ name: createName });
      vehicle.add(trigger);
    }

    vehicle.updateMatrixWorld(true);
    this.tmpBounds.setFromObject(vehicle);
    if (this.tmpBounds.isEmpty()) {
      return trigger;
    }

    const xzFrac = options.xzFrac ?? 0.94;
    const topPad = options.topPad ?? 0.12;
    const minHeight = options.minHeight ?? 0.45;

    this.tmpBounds.getSize(this.tmpHead);
    const topY = this.tmpBounds.max.y + topPad;
    const bottomY = this.tmpBounds.min.y + this.tmpHead.y * options.bottomHeightFrac;
    this.tmpRestorePos.set(
      (this.tmpBounds.min.x + this.tmpBounds.max.x) * 0.5,
      (bottomY + topY) * 0.5,
      (this.tmpBounds.min.z + this.tmpBounds.max.z) * 0.5,
    );
    const worldW = Math.max(0.5, this.tmpHead.x * xzFrac);
    const worldD = Math.max(0.5, this.tmpHead.z * xzFrac);
    const worldH = Math.max(minHeight, topY - bottomY);

    vehicle.worldToLocal(this.tmpRestorePos);
    trigger.position.copy(this.tmpRestorePos);
    vehicle.getWorldScale(this.tmpWorldScale);
    trigger.scale.set(
      worldW / Math.max(1e-4, this.tmpWorldScale.x),
      worldH / Math.max(1e-4, this.tmpWorldScale.y),
      worldD / Math.max(1e-4, this.tmpWorldScale.z),
    );
    trigger.visible = false;
    return trigger;
  }

  private cacheTrafficCones(): void {
    this.trafficCones.length = 0;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      const name = node.name ?? '';
      if (TRAFFIC_CONE_NAME.test(name) || CONES_NAME.test(name)) {
        this.trafficCones.push(node);
      }
    }
  }

  private hideInitialOrdinanceProps(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    this.hiddenOrdinances = [];
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      const url = node.modelUrl ?? '';
      const name = node.name ?? '';
      const isOrdinanceModel = ORDINANCE_MODEL_PATH.test(url);
      const isTrafficCone = TRAFFIC_CONE_NAME.test(name);
      const isConeGroup = CONES_NAME.test(name) || /^OrdinanceCones$/i.test(name);
      if (!isOrdinanceModel && !isTrafficCone && !isConeGroup) {
        continue;
      }
      if (this.hiddenOrdinances.some((h) => h.node === node)) {
        continue;
      }
      // Capture authored physics BEFORE disabling for hide.
      const physicsOptions = { ...node.getPhysicsOptions() };
      this.hiddenOrdinances.push({
        node,
        physicsOptions,
        movable: isTrafficCone,
      });
      this.setOrdinanceVisible(node, false);
    }
  }

  /** After Play, show ordinance boards again so they remain visible while editing. */
  private restoreOrdinanceVisibilityForEditMode(): void {
    for (const record of this.hiddenOrdinances) {
      this.setOrdinanceVisible(record.node, true);
    }
    // Pole-mounted boards may have been play-hidden without a record if parenting changed.
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      const name = node.name ?? '';
      if (
        DONT_CUT_THIS_POLE_ANY_NAME.test(name)
        || /^High Voltage(?:\s+\d+)?$/i.test(name)
        || /^Street Lights (?:Climb|Destroy)(?:\s+\d+)?$/i.test(name)
        || NO_CUTTING_OF_TREES_ANY_NAME.test(name)
        || NO_CLIMBING_ON_THE_TREE_ANY_NAME.test(name)
      ) {
        node.visible = true;
        node.overridePhysicsOptions({
          enabled: false,
          motionType: ENGINE.PhysicsMotionType.Static,
        });
      }
    }
  }

  private setOrdinanceVisible(node: ENGINE.ModelMeshNode | null, visible: boolean): void {
    if (!node) {
      return;
    }
    node.visible = visible;
    node.traverse((child) => {
      child.visible = visible;
    });

    // Host-mounted ordinance boards — nested physics crashes Rapier. Keep visual-only.
    if (
      DONT_CUT_THIS_POLE_ANY_NAME.test(node.name ?? '')
      || /^High Voltage(?:\s+\d+)?$/i.test(node.name ?? '')
      || /^Street Lights (?:Climb|Destroy)(?:\s+\d+)?$/i.test(node.name ?? '')
      || NO_CUTTING_OF_TREES_ANY_NAME.test(node.name ?? '')
      || NO_CLIMBING_ON_THE_TREE_ANY_NAME.test(node.name ?? '')
    ) {
      node.overridePhysicsOptions({
        enabled: false,
        motionType: ENGINE.PhysicsMotionType.Static,
      });
      node.setPhysicsTransformUpdateFlags({
        sendPosition: false,
        sendRotation: false,
        receivePosition: false,
        receiveRotation: false,
      });
      return;
    }

    const record = this.hiddenOrdinances.find((h) => h.node === node);
    if (!record) {
      node.overridePhysicsOptions({ enabled: visible });
      return;
    }

    if (!visible) {
      node.overridePhysicsOptions({ enabled: false });
      return;
    }

    if (record.movable) {
      // Keep cones pushable / carryable after reveal and day resets.
      node.replacePhysicsOptions({
        ...record.physicsOptions,
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.Dynamic,
      });
      node.setPhysicsTransformUpdateFlags({
        sendPosition: false,
        sendRotation: false,
        receivePosition: true,
        receiveRotation: true,
      });
      node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [0, 0, 0]);
      node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);
      return;
    }

    node.overridePhysicsOptions({
      ...record.physicsOptions,
      enabled: record.physicsOptions.enabled !== false,
    });
  }

  private findModelByName(pattern: RegExp): ENGINE.ModelMeshNode | null {
    const world = this.getWorld();
    if (!world) {
      return null;
    }
    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      if (pattern.test(node.name ?? '')) {
        return node;
      }
    }
    return null;
  }

  private ensureGreenOutline(world: ENGINE.World): void {
    if (this.outlineReady) {
      return;
    }
    world.postProcessManager.configureEffect(ENGINE.PostProcessPass.ObjectOutline, {
      enabled: true,
      edgeStrength: 2.5,
      edgeThickness: 1.75,
      visibleEdgeColor: OUTLINE_GREEN,
      hiddenEdgeColor: OUTLINE_GREEN,
      showHiddenEdge: false,
      useRootGrouping: true,
      edgeBlur: 0,
    });
    this.outlineReady = true;
  }

  private updateMailboxHoverOutline(): void {
    if (this.catMailCourier.isInteractable()) {
      // Cat outline is applied in tickHoverOutline after this call.
      this.setMailboxHoverOutline(false);
      return;
    }
    const canHover = this.phase === FlowPhase.AwaitingDelivery
      || this.phase === FlowPhase.ZoomOutReveal;
    const hovered = canHover
      && this.isMailboxInRange()
      && this.isAimingAtMailbox();
    this.setMailboxHoverOutline(hovered);
  }

  private setMailboxHoverOutline(enabled: boolean): void {
    if (this.mailboxHovered === enabled) {
      return;
    }
    this.mailboxHovered = enabled;
    const world = this.getWorld();
    if (!world || !this.mailbox) {
      return;
    }
    this.ensureGreenOutline(world);
    if (enabled) {
      world.postProcessManager.setOutlineSelection([this.mailbox]);
    } else {
      world.postProcessManager.clearOutlineSelection();
    }
  }

  private setMailboxHighlight(enabled: boolean): void {
    // The mailbox cue is part of the route hint; never show it by itself.
    const shouldEnable = enabled && this.trailGroup?.visible === true;
    if (!shouldEnable) {
      this.restoreMailboxMaterials();
      this.mailboxHighlightActive = false;
      return;
    }
    if (!this.mailbox || this.mailboxHighlightActive) {
      return;
    }
    this.mailboxHighlightActive = true;
    this.applyMailboxPulseMaterials();
  }

  private applyMailboxPulseMaterials(): void {
    if (!this.mailbox) {
      return;
    }
    this.restoreMailboxMaterials();
    for (const mesh of this.mailbox.getAllMeshes()) {
      const originalMaterial = mesh.material;
      const pulseMaterial = Array.isArray(originalMaterial)
        ? originalMaterial.map((mat) => this.createPulseMaterial(mat))
        : this.createPulseMaterial(originalMaterial);
      this.mailboxPulseRecords.push({ mesh, originalMaterial, pulseMaterial });
      mesh.material = pulseMaterial;
    }
  }

  private createPulseMaterial(material: THREE.Material): THREE.Material {
    const pulse = material.clone() as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
    };
    pulse.color?.copy(HIGHLIGHT_RED);
    if (pulse.emissive) {
      pulse.emissive.copy(HIGHLIGHT_EMISSIVE);
      if (typeof pulse.emissiveIntensity === 'number') {
        pulse.emissiveIntensity = 1.4;
      }
    }
    pulse.needsUpdate = true;
    return pulse;
  }

  private updateMailboxPulse(): void {
    if (!this.mailboxHighlightActive) {
      return;
    }
    if (this.mailboxPulseRecords.length === 0) {
      this.applyMailboxPulseMaterials();
      if (this.mailboxPulseRecords.length === 0) {
        return;
      }
    }
    const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.pulseTime * 4.5));
    const tint = HIGHLIGHT_RED.clone().lerp(new THREE.Color(0xff7777), pulse);
    for (const record of this.mailboxPulseRecords) {
      const mats = Array.isArray(record.pulseMaterial)
        ? record.pulseMaterial
        : [record.pulseMaterial];
      for (const mat of mats) {
        const m = mat as THREE.Material & {
          color?: THREE.Color;
          emissive?: THREE.Color;
          emissiveIntensity?: number;
        };
        m.color?.copy(tint);
        if (m.emissive) {
          m.emissive.copy(HIGHLIGHT_EMISSIVE).multiplyScalar(0.55 + pulse * 0.9);
          if (typeof m.emissiveIntensity === 'number') {
            m.emissiveIntensity = 0.55 + pulse * 1.6;
          }
        }
        m.needsUpdate = true;
      }
    }
  }

  private restoreMailboxMaterials(): void {
    for (const record of this.mailboxPulseRecords) {
      record.mesh.material = record.originalMaterial;
      const mats = Array.isArray(record.pulseMaterial)
        ? record.pulseMaterial
        : [record.pulseMaterial];
      for (const mat of mats) {
        mat.dispose();
      }
    }
    this.mailboxPulseRecords.length = 0;
  }

  /** Start a queued first-reveal pulse once ordinance focus returns to the player. */
  private beginPendingRoadHighlight(): void {
    const kind = this.pendingRoadHighlight;
    this.pendingRoadHighlight = null;
    if (!kind) {
      return;
    }
    this.startRoadHighlight(kind);
  }

  /** Pulse a newly revealed or subsequently violated road red. */
  private startRoadHighlight(kind: RoadHighlightKind): void {
    this.clearRoadHighlight();
    if (kind === 'mainRoad') {
      if (this.mainRoadNodes.length === 0) {
        this.cacheMainRoads();
      }
    } else if (this.leftSideRoadNodes.length === 0) {
      this.cacheLeftSideRoads();
    }
    const nodes = kind === 'mainRoad' ? this.mainRoadNodes : this.leftSideRoadNodes;
    for (const node of nodes) {
      this.applyRoadPulseMaterialsToNode(node);
    }
    if (this.roadHighlightPulseRecords.length === 0) {
      return;
    }
    this.roadHighlightActive = true;
    this.roadHighlightElapsed = 0;
  }

  private applyRoadPulseMaterialsToNode(node: ENGINE.SceneNode): void {
    const meshes: THREE.Mesh[] = [];
    if (node instanceof ENGINE.ModelMeshNode) {
      meshes.push(...node.getAllMeshes());
    } else {
      node.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (mesh.isMesh) {
          meshes.push(mesh);
        }
      });
    }
    for (const mesh of meshes) {
      const originalMaterial = mesh.material;
      const pulseMaterial = Array.isArray(originalMaterial)
        ? originalMaterial.map((mat) => this.createRoadPulseMaterial(mat))
        : this.createRoadPulseMaterial(originalMaterial);
      this.roadHighlightPulseRecords.push({ mesh, originalMaterial, pulseMaterial });
      mesh.material = pulseMaterial;
    }
  }

  /** Solid red overlay, removed abruptly after the brief road cue. */
  private createRoadPulseMaterial(material: THREE.Material): THREE.Material {
    const pulse = material.clone() as THREE.Material & {
      color?: THREE.Color;
      emissive?: THREE.Color;
      emissiveIntensity?: number;
      transparent?: boolean;
      opacity?: number;
      depthWrite?: boolean;
    };
    if (pulse.color) {
      pulse.color.copy(HIGHLIGHT_RED).multiplyScalar(0.72);
    }
    if (pulse.emissive) {
      pulse.emissive.copy(HIGHLIGHT_EMISSIVE).multiplyScalar(0.18);
      if (typeof pulse.emissiveIntensity === 'number') {
        pulse.emissiveIntensity = 0.28;
      }
    }
    pulse.transparent = true;
    pulse.opacity = 1;
    pulse.depthWrite = false;
    pulse.needsUpdate = true;
    return pulse;
  }

  private updateRoadHighlightPulse(deltaTime: number): void {
    if (!this.roadHighlightActive) {
      return;
    }
    this.roadHighlightElapsed += deltaTime;
    if (this.roadHighlightElapsed >= ROAD_HIGHLIGHT_DURATION_SEC) {
      this.clearRoadHighlight();
    }
  }

  private clearRoadHighlight(): void {
    for (const record of this.roadHighlightPulseRecords) {
      record.mesh.material = record.originalMaterial;
      const mats = Array.isArray(record.pulseMaterial)
        ? record.pulseMaterial
        : [record.pulseMaterial];
      for (const mat of mats) {
        mat.dispose();
      }
    }
    this.roadHighlightPulseRecords.length = 0;
    this.roadHighlightActive = false;
    this.roadHighlightElapsed = 0;
  }

  private async buildTrail(world: ENGINE.World): Promise<void> {
    this.clearTrail();
    const texture = await ENGINE.resourceManager.loadTexture(
      ENGINE.AssetPath.fromString(TRAIL_ARROW_TEXTURE_PATH),
    );
    if (!texture) {
      console.error(`Failed to load mail trail texture: ${TRAIL_ARROW_TEXTURE_PATH}`);
      return;
    }

    const group = new THREE.Group();
    group.name = 'MailDeliveryTrail';
    group.visible = false;
    group.setTransient(true);
    this.trailArrowTexture = texture;
    this.trailArrowTexture.colorSpace = THREE.SRGBColorSpace;
    this.trailArrowTexture.needsUpdate = true;
    this.trailArrowMaterial = new THREE.MeshBasicMaterial({
      map: this.trailArrowTexture,
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    for (let i = 0; i < TRAIL_ARROW_MAX_COUNT; i += 1) {
      const geo = new THREE.PlaneGeometry(TRAIL_ARROW_WIDTH, TRAIL_ARROW_HEIGHT);
      const mesh = new THREE.Mesh(geo, this.trailArrowMaterial);
      mesh.setTransient(true);
      group.add(mesh);
      this.trailArrows.push(mesh);
    }
    world.add(group);
    this.trailGroup = group;
  }

  private setTrailVisible(visible: boolean): void {
    if (!this.trailGroup) {
      return;
    }
    this.trailGroup.visible = visible;
    this.setMailboxHighlight(visible);
  }

  private updateTrailVisibility(deltaTime: number): void {
    if (!this.trailGroup?.visible || !Number.isFinite(this.trailVisibleRemaining)) {
      return;
    }
    this.trailVisibleRemaining = Math.max(0, this.trailVisibleRemaining - deltaTime);
    if (this.trailVisibleRemaining === 0) {
      this.setTrailVisible(false);
    }
  }

  private updateTrail(): void {
    if (!this.trailGroup?.visible || !this.player || !this.mailbox) {
      return;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y += 0.35;
    this.mailbox.getWorldPosition(this.tmpMailboxPos);
    this.tmpMailboxPos.y += 0.8;
    this.tmpDir.subVectors(this.tmpMailboxPos, this.tmpPlayerPos);
    const length = this.tmpDir.length();
    if (length < 0.2) {
      this.trailGroup.visible = false;
      return;
    }
    this.tmpDir.multiplyScalar(1 / length);
    this.tmpForward.crossVectors(this.upAxis, this.tmpDir);
    if (this.tmpForward.lengthSq() < 1e-6) {
      this.tmpForward.set(1, 0, 0);
    } else {
      this.tmpForward.normalize();
    }
    this.tmpMatrix.makeBasis(this.tmpDir, this.tmpForward, this.upAxis);

    // The route is recomputed from the player's current position, but the
    // arrow phase is independent of route length. That keeps their speed and
    // spacing stable as the player approaches the mailbox.
    const phaseDistance = (this.pulseTime * TRAIL_ARROW_TRAVEL_SPEED)
      % TRAIL_ARROW_SPACING;
    for (let i = 0; i < this.trailArrows.length; i += 1) {
      const arrow = this.trailArrows[i];
      const distance = phaseDistance + i * TRAIL_ARROW_SPACING;
      if (distance > length) {
        arrow.visible = false;
        continue;
      }
      arrow.position.lerpVectors(this.tmpPlayerPos, this.tmpMailboxPos, distance / length);
      arrow.quaternion.setFromRotationMatrix(this.tmpMatrix);
      arrow.scale.setScalar(1);
      arrow.visible = true;
    }
  }

  private clearTrail(): void {
    if (!this.trailGroup) {
      return;
    }
    this.trailGroup.removeFromParent();
    for (const arrow of this.trailArrows) {
      arrow.geometry.dispose();
    }
    this.trailArrowMaterial?.dispose();
    this.trailArrowMaterial = null;
    this.trailArrowTexture = null;
    this.trailArrows.length = 0;
    this.trailGroup = null;
  }

  private ensureUi(world: ENGINE.World): boolean {
    const container = world.gameContainer;
    if (!container) {
      return false;
    }

    if (!this.speechEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute',
        'left:50%',
        'top:18%',
        'transform:translate(-50%,-100%)',
        'padding:12px 16px',
        'border-radius:16px',
        'background:rgba(255,255,255,0.96)',
        'color:#1a1a1a',
        'font:600 16px/1.35 "Segoe UI",system-ui,sans-serif',
        'box-shadow:0 8px 22px rgba(0,0,0,0.28)',
        'pointer-events:none',
        'white-space:nowrap',
        'display:none',
        'z-index:2000',
        'max-width:min(420px,80vw)',
      ].join(';');
      const tail = document.createElement('div');
      tail.style.cssText = [
        'position:absolute',
        'left:50%',
        'bottom:-8px',
        'transform:translateX(-50%)',
        'width:0',
        'height:0',
        'border-left:9px solid transparent',
        'border-right:9px solid transparent',
        'border-top:9px solid rgba(255,255,255,0.96)',
      ].join(';');
      el.appendChild(tail);
      const label = document.createElement('span');
      label.dataset.speechLabel = '1';
      el.appendChild(label);
      container.appendChild(el);
      this.speechEl = el;
    }

    if (!this.fadeEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute',
        'inset:0',
        'background:#000',
        'opacity:0',
        'pointer-events:none',
        'z-index:2100',
        'transition:none',
      ].join(';');
      container.appendChild(el);
      this.fadeEl = el;
    }

    if (!this.nextDayEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute',
        'left:50%',
        'top:50%',
        'transform:translate(-50%, -50%)',
        'color:#f5f5f5',
        'font:700 34px/1.2 Georgia,"Times New Roman",serif',
        'letter-spacing:0.02em',
        'text-shadow:0 2px 14px rgba(0,0,0,0.75)',
        'pointer-events:none',
        'display:none',
        'z-index:2200',
        'text-align:center',
        'white-space:nowrap',
      ].join(';');
      el.textContent = 'The Next Day...';
      container.appendChild(el);
      this.nextDayEl = el;
    }

    return true;
  }

  private showSpeechBubble(text: string): void {
    const world = this.getWorld();
    if (!this.speechEl && world) {
      this.ensureUi(world);
    }
    if (!this.speechEl) {
      return;
    }
    const label = this.speechEl.querySelector('[data-speech-label]') as HTMLSpanElement | null;
    if (label) {
      label.textContent = text;
    } else {
      this.speechEl.textContent = text;
    }
    this.speechEl.style.display = 'block';
    this.speechEl.style.left = '50%';
    this.speechEl.style.top = '18%';
    this.player?.setMailEnvelopeHighlightPulsing(true);
    this.updateSpeechBubblePosition();
  }

  private hideSpeechBubble(): void {
    if (this.speechEl) {
      this.speechEl.style.display = 'none';
    }
    this.player?.setMailEnvelopeHighlightPulsing(false);
  }

  private updateSpeechBubblePosition(): void {
    if (!this.speechEl || this.speechEl.style.display === 'none') {
      return;
    }
    const world = this.getWorld();
    const container = world?.gameContainer;
    const camera = this.player?.getGameplayCamera();
    if (!container || !camera || !this.player) {
      return;
    }

    this.resolvePlayerHeadWorld(this.tmpHead);
    this.tmpProjected.copy(this.tmpHead).project(camera);
    if (this.tmpProjected.z < -1 || this.tmpProjected.z > 1) {
      return;
    }

    const canvas = container.querySelector('canvas');
    const containerRect = container.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect() ?? containerRect;
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return;
    }

    const x = (this.tmpProjected.x * 0.5 + 0.5) * canvasRect.width
      + (canvasRect.left - containerRect.left);
    const y = (-this.tmpProjected.y * 0.5 + 0.5) * canvasRect.height
      + (canvasRect.top - containerRect.top);
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return;
    }
    this.speechEl.style.left = `${x}px`;
    this.speechEl.style.top = `${Math.max(16, y)}px`;
  }

  private resolvePlayerHeadWorld(out: THREE.Vector3): void {
    if (!this.player) {
      out.set(0, 0, 0);
      return;
    }
    this.tmpBounds.setFromObject(this.player);
    if (!this.tmpBounds.isEmpty()) {
      this.tmpBounds.getCenter(out);
      out.y = this.tmpBounds.max.y + 0.12;
      return;
    }
    this.player.getWorldPosition(out);
    out.y += 1.7;
  }

  private setFade(opacity: number): void {
    if (this.fadeEl) {
      this.fadeEl.style.opacity = String(Math.max(0, Math.min(1, opacity)));
    }
  }

  private showNextDayLabel(visible: boolean): void {
    if (this.nextDayEl) {
      this.nextDayEl.style.display = visible ? 'block' : 'none';
    }
  }

  private teardownUi(): void {
    this.speechEl?.remove();
    this.fadeEl?.remove();
    this.nextDayEl?.remove();
    this.speechEl = null;
    this.fadeEl = null;
    this.nextDayEl = null;
    this.player?.setMailEnvelopeHighlightPulsing(false);
  }

  private isCameraNear(distance: number, epsilon: number): boolean {
    if (!this.player) {
      return true;
    }
    return Math.abs(this.player.getCameraArmLength() - distance) <= epsilon;
  }

  /**
   * Instant spawn teleport while the screen is fully black.
   * Scrap teardown / world restore / ordinance reveal happen later via staging.
   */
  private performHiddenTeleport(): void {
    this.clearEnvelope();
    this.stopModelFrontCinematic();
    this.dayTransitionScrapRetired = false;
    this.dayTransitionWorldRestored = false;
    this.dayTransitionWorldRestoreStarted = false;
    this.dayTransitionWorldRestoreCursor = 0;
    this.dayTransitionWorldRestoredAt = 0;
    this.dayTransitionOrdinanceRevealed = false;
    this.dayTransitionOrdinanceRevealedAt = 0;
    this.dayTransitionCamReady = false;
    this.player?.releaseHeldItemsForDayReset();
    this.player?.prepareScrapForCinematic();
    this.player?.setMovementFrozen(true);
    this.player?.teleportToPlayerStartAndSettle();
    this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
  }

  /**
   * Under full black: retire scrap → wait for GPU destroy → restore world →
   * reveal boards → snap ordinance cam.
   */
  private tickDayTransitionStaging(): void {
    // Let the dismantling system tick deferred destroys once per update —
    // do not double-increment the GPU settle counter from here.
    const t = this.phaseElapsed;

    if (!this.dayTransitionScrapRetired && t >= DAY_TRANSITION_SCRAP_RETIRE_SEC) {
      this.player?.retireScrapForDayReset();
      this.dayTransitionScrapRetired = true;
    }

    if (
      this.dayTransitionScrapRetired
      && !this.dayTransitionWorldRestored
      && t >= DAY_TRANSITION_WORLD_RESTORE_SEC
      && !(this.player?.hasPendingScrapDestroys() ?? false)
    ) {
      if (!this.dayTransitionWorldRestoreStarted) {
        this.beginStagedDayBaselineRestore();
      }
      if (this.tickStagedDayBaselineRestore()) {
        this.dayTransitionWorldRestored = true;
        this.dayTransitionWorldRestoredAt = t;
      }
    }

    if (
      this.dayTransitionWorldRestored
      && !this.dayTransitionOrdinanceRevealed
      && t >= this.dayTransitionWorldRestoredAt + DAY_TRANSITION_REVEAL_COOLDOWN_SEC
      && !(this.player?.hasPendingScrapDestroys() ?? false)
    ) {
      this.applyQueuedOrdinanceReveals();
      this.dayTransitionOrdinanceRevealed = true;
      this.dayTransitionOrdinanceRevealedAt = t;
    }

    if (
      this.dayTransitionOrdinanceRevealed
      && !this.dayTransitionCamReady
      && t >= this.dayTransitionOrdinanceRevealedAt + DAY_TRANSITION_CINEMATIC_COOLDOWN_SEC
    ) {
      this.ensureWakeOrdinanceCinematic();
      this.dayTransitionCamReady = true;
    }
  }

  private isDayTransitionHoldComplete(): boolean {
    return this.dayTransitionCamReady && this.phaseElapsed >= NEXT_DAY_LABEL_SEC;
  }

  private shouldSkipDayReset(node: ENGINE.SceneNode): boolean {
    if (node === this || node === this.player) {
      return true;
    }
    if (node instanceof ThirdPersonPlayer) {
      return true;
    }
    if (node instanceof MailDeliveryFlowSystem) {
      return true;
    }
    if (node instanceof ENGINE.ViewTargetCameraNode) {
      return true;
    }
    if (node instanceof ENGINE.PlayerStart) {
      return true;
    }
    if (node instanceof ENGINE.PlayerController) {
      return true;
    }
    return false;
  }

  private isUnderSkippedAncestor(node: ENGINE.SceneNode): boolean {
    let parent = node.parent as ENGINE.SceneNode | null;
    while (parent) {
      if (this.shouldSkipDayReset(parent)) {
        return true;
      }
      parent = parent.parent as ENGINE.SceneNode | null;
    }
    return false;
  }

  /**
   * One-time session snapshot of authored prop world transforms (after ordinances are hidden).
   * Never overwritten — later days restore back to this pose, then re-apply ordinance visibility.
   */
  private captureSessionBaseline(): void {
    if (this.sessionBaselineCaptured) {
      return;
    }
    const world = this.getWorld();
    this.daySnapshots.length = 0;
    this.dayBaselineIds.clear();
    if (!world) {
      return;
    }

    for (const root of world.getRootNodes()) {
      if (this.shouldSkipDayReset(root)) {
        continue;
      }
      this.dayBaselineIds.add(root.uuid);
      this.pushDaySnapshot(root);
    }

    for (const node of world.getNodes(ENGINE.ModelMeshNode)) {
      this.pushDaySnapshot(node);
    }

    // Parents first so child world→local conversion uses restored parents.
    this.daySnapshots.sort(
      (a, b) => this.getNodeDepth(a.node) - this.getNodeDepth(b.node),
    );

    this.sessionBaselineCaptured = this.daySnapshots.length > 0;
  }

  private getNodeDepth(node: ENGINE.SceneNode): number {
    let depth = 0;
    let parent = node.parent as ENGINE.SceneNode | null;
    while (parent) {
      depth += 1;
      parent = parent.parent as ENGINE.SceneNode | null;
    }
    return depth;
  }

  private pushDaySnapshot(node: ENGINE.SceneNode): void {
    if (this.shouldSkipDayReset(node) || this.isUnderSkippedAncestor(node)) {
      return;
    }
    if (this.daySnapshots.some((snap) => snap.node === node)) {
      return;
    }
    // Never snapshot author triggers — day restore must not overwrite their scale.
    const name = node.name ?? '';
    if (
      TRAM_TRIGGER_NAME.test(name)
      || TRAM_ROOF_TRIGGER_NAME.test(name)
      || CAR_ROOF_TRIGGER_NAME.test(name)
      || LAMP_TRIGGER_NAME.test(name)
      || WIRE_TRIGGER_NAME.test(name)
    ) {
      return;
    }
    // Skip deep GLB internals — only restore authored scene nodes / prop roots.
    if (this.isGlbInternalChild(node)) {
      return;
    }

    let physicsOptions: ENGINE.NodePhysicsOptions | null = null;
    if (node instanceof ENGINE.PrimitiveNode) {
      physicsOptions = { ...node.getPhysicsOptions() };
    }
    this.daySnapshots.push({
      node,
      localPosition: node.position.clone(),
      localQuaternion: node.quaternion.clone(),
      scale: node.scale.clone(),
      physicsOptions,
    });
  }

  /** Child meshes under a ModelMeshNode load are not independently moved by gameplay. */
  private isGlbInternalChild(node: ENGINE.SceneNode): boolean {
    let parent = node.parent as ENGINE.SceneNode | null;
    while (parent) {
      if (parent instanceof ENGINE.ModelMeshNode && parent !== node) {
        return true;
      }
      parent = parent.parent as ENGINE.SceneNode | null;
    }
    return false;
  }

  /**
   * Put moved/thrown props back to the session baseline, and remove scrap spawned mid-day.
   * Dismantled props are restored by StreetLampDismantlingSystem.finishDayReset (called first).
   */
  private restoreDayBaseline(): void {
    const world = this.getWorld();
    if (!world || this.daySnapshots.length === 0) {
      return;
    }

    this.beginDayBaselineRestore(world);
    this.applyAllSnapshotPoses();
    this.completeDayBaselineRestore();
  }

  /** Start a black-screen reset without submitting every prop update in one frame. */
  private beginStagedDayBaselineRestore(): void {
    if (this.dayTransitionWorldRestoreStarted) {
      return;
    }
    const world = this.getWorld();
    if (!world || this.daySnapshots.length === 0) {
      this.dayTransitionWorldRestoreStarted = true;
      this.dayTransitionWorldRestoreCursor = this.daySnapshots.length;
      return;
    }
    this.beginDayBaselineRestore(world);
    this.dayTransitionWorldRestoreStarted = true;
    this.dayTransitionWorldRestoreCursor = 0;
  }

  /** Restore a bounded batch each frame; returns true once the reset is fully settled. */
  private tickStagedDayBaselineRestore(): boolean {
    if (!this.dayTransitionWorldRestoreStarted) {
      return false;
    }
    const end = Math.min(
      this.dayTransitionWorldRestoreCursor + DAY_TRANSITION_RESTORE_BATCH_SIZE,
      this.daySnapshots.length,
    );
    for (let index = this.dayTransitionWorldRestoreCursor; index < end; index += 1) {
      const snap = this.daySnapshots[index];
      if (snap) {
        this.applySnapshotPose(snap, false, false);
      }
    }
    this.dayTransitionWorldRestoreCursor = end;
    if (end < this.daySnapshots.length) {
      return false;
    }
    this.completeDayBaselineRestore();
    return true;
  }

  private beginDayBaselineRestore(world: ENGINE.World): void {
    this.propPrevBottomY.clear();
    for (const root of [...world.getRootNodes()]) {
      if (this.shouldSkipDayReset(root) || this.dayBaselineIds.has(root.uuid)) {
        continue;
      }
      // Hide + detach only — immediate destroy of heavy scrap mid-frame loses WebGPU.
      // Deferred destroy runs through StreetLampDismantlingSystem while still under black.
      root.visible = false;
      root.traverse((child) => {
        child.visible = false;
      });
      root.removeFromParent();
      this.player?.retireDetachedRootForDayReset(root);
    }
  }

  private completeDayBaselineRestore(): void {
    this.catMailCourier.resetToHome();
    this.reapplyOrdinanceVisibility();
    this.baselineReinforceRemaining = 10;
  }

  private applyAllSnapshotPoses(options?: {
    finalizePhysics?: boolean;
    /** Reapply only movable bodies during the short post-reset physics settle. */
    dynamicOnly?: boolean;
  }): void {
    const finalizePhysics = options?.finalizePhysics === true;
    const dynamicOnly = options?.dynamicOnly === true;
    for (const snap of this.daySnapshots) {
      this.applySnapshotPose(snap, finalizePhysics, dynamicOnly);
    }
  }

  private applySnapshotPose(
    snap: DayTransformSnapshot,
    finalizePhysics: boolean,
    dynamicOnly: boolean,
  ): void {
    const node = snap.node;
    if (!node.parent) {
      return;
    }

    const hidden = this.hiddenOrdinances.find((h) => h.node === node);
    const physicsOptions = hidden?.movable
      ? hidden.physicsOptions
      : snap.physicsOptions;
    const isMovable = hidden?.movable === true
      || physicsOptions?.motionType === ENGINE.PhysicsMotionType.Dynamic;
    if (dynamicOnly && !isMovable) {
      return;
    }

    node.position.copy(snap.localPosition);
    node.quaternion.copy(snap.localQuaternion);
    node.scale.copy(snap.scale);
    node.updateMatrixWorld(true);

    if (!(node instanceof ENGINE.PrimitiveNode)) {
      return;
    }

    // Static scenery never moves during play. Reset its scene transform once, but avoid
    // flooding the physics/GPU bridge with redundant teleports and velocity writes.
    if (!isMovable) {
      return;
    }

    if (physicsOptions) {
      // Movable cones stay disabled until reapplyOrdinanceVisibility reveals them.
      const enabled = hidden?.movable
        ? false
        : physicsOptions.enabled !== false;
      node.replacePhysicsOptions({
        ...physicsOptions,
        enabled,
      });
    }

    // Drive body from node so dynamic leftovers can't snap the mesh back.
    node.setPhysicsTransformUpdateFlags({
      sendPosition: true,
      sendRotation: true,
      receivePosition: false,
      receiveRotation: false,
    });

    const physicsEngine = this.getPhysicsEngine()
      ?? this.player?.getPhysicsEngine()
      ?? node.getPhysicsEngine();
    if (physicsEngine) {
      node.getWorldPosition(this.tmpRestorePos);
      node.getWorldQuaternion(this.tmpRestoreQuat);
      physicsEngine.teleportBody(node, this.tmpRestorePos, this.tmpRestoreQuat);
    }
    node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [0, 0, 0]);
    node.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.AngularVelocity, [0, 0, 0]);

    if (!finalizePhysics || !physicsOptions || hidden?.movable) {
      // Movable cones get Dynamic+receive flags when setOrdinanceVisible(true) runs.
      return;
    }

    // After reinforce ends, allow authored dynamics to receive again.
    const isDynamic = physicsOptions.motionType === ENGINE.PhysicsMotionType.Dynamic;
    node.setPhysicsTransformUpdateFlags({
      sendPosition: !isDynamic,
      sendRotation: !isDynamic,
      receivePosition: isDynamic,
      receiveRotation: isDynamic,
    });
  }

  private getMailboxFacing(out: THREE.Vector3): THREE.Vector3 {
    if (!this.mailbox) {
      return out.set(0, 0, 1);
    }
    this.mailbox.getWorldQuaternion(this.tmpQuat);
    out.set(0, 0, 1).applyQuaternion(this.tmpQuat);
    out.y = 0;
    if (out.lengthSq() < 1e-6) {
      return out.set(0, 0, 1);
    }
    return out.normalize();
  }

  private startEnvelopeInsert(): void {
    this.clearEnvelope();
    if (!this.mailbox) {
      return;
    }

    this.tmpBounds.setFromObject(this.mailbox);
    if (this.tmpBounds.isEmpty()) {
      this.mailbox.getWorldPosition(this.tmpMailboxPos);
      this.tmpBounds.setFromCenterAndSize(this.tmpMailboxPos, new THREE.Vector3(0.6, 1.2, 0.5));
    }
    this.tmpBounds.getCenter(this.tmpMailboxPos);
    const size = this.tmpHead;
    this.tmpBounds.getSize(size);

    this.getMailboxFacing(this.tmpForward);
    // Slot on the front face — slightly above center for the inlet.
    this.envelopeEndPos
      .copy(this.tmpMailboxPos)
      .addScaledVector(this.tmpForward, size.z * 0.42)
      .addScaledVector(this.upAxis, size.y * 0.2 + ENVELOPE_SLOT_Y_BOOST);
    this.envelopeStartPos
      .copy(this.envelopeEndPos)
      .addScaledVector(this.tmpForward, 0.42);
    this.envelopeEndPos.addScaledVector(this.tmpForward, -0.28);

    this.tmpHitPoint.copy(this.envelopeStartPos).add(this.tmpForward);
    this.tmpMatrix.lookAt(this.envelopeStartPos, this.tmpHitPoint, this.upAxis);
    this.envelopeQuat.setFromRotationMatrix(this.tmpMatrix);

    const mesh = createAirmailEnvelope(0.36, 0.028, 0.24);
    mesh.name = 'DeliveryEnvelope';
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.position.copy(this.envelopeStartPos);
    mesh.quaternion.copy(this.envelopeQuat);
    this.add(mesh);
    this.envelopeMesh = mesh;
    this.envelopeProgress = 0;
  }

  private updateEnvelopeInsert(deltaTime: number): void {
    if (!this.envelopeMesh || this.phase !== FlowPhase.DeliveryFocus) {
      return;
    }
    this.envelopeProgress = Math.min(1, this.envelopeProgress + deltaTime / ENVELOPE_INSERT_SEC);
    const t = this.envelopeProgress;
    const eased = t * t * (3 - 2 * t);
    this.envelopeMesh.position.lerpVectors(this.envelopeStartPos, this.envelopeEndPos, eased);
    // Softly shrink as it disappears into the slot.
    const scale = THREE.MathUtils.lerp(1, 0.55, eased);
    this.envelopeMesh.scale.set(scale, scale, scale);
    if (t >= 1) {
      this.envelopeMesh.visible = false;
    }
  }

  private clearEnvelope(): void {
    if (!this.envelopeMesh) {
      this.envelopeProgress = 0;
      return;
    }
    disposeAirmailEnvelope(this.envelopeMesh);
    this.envelopeMesh = null;
    this.envelopeProgress = 0;
  }

  private ensureViewTargetCamera(): ENGINE.ViewTargetCameraNode | null {
    if (this.viewTargetCam) {
      return this.viewTargetCam;
    }
    const world = this.getWorld();
    if (!world) {
      return null;
    }
    this.viewTargetCam = ENGINE.ViewTargetCameraNode.create({
      name: 'Mail Delivery Cinematic Camera',
      fov: 55,
      near: 0.05,
      far: 500,
      startActive: false,
    });
    this.add(this.viewTargetCam);
    return this.viewTargetCam;
  }

  /**
   * Cutscene camera: blend from the active cam into a shot in front of the model.
   * Pass `immediate` to snap (used under black so fade-in is already framed).
   * `pitchFromFloorDeg` elevates the camera (e.g. 30° = look down 30° from horizontal).
   * `useCapturedStart` keeps `cinematicStartPos/Quat` already filled (soft-loop).
   */
  private startModelFrontCinematic(
    target: ENGINE.SceneNode | null,
    distance: number,
    immediate = false,
    pitchFromFloorDeg = 0,
    useCapturedStart = false,
  ): void {
    if (!target) {
      return;
    }
    const camNode = this.ensureViewTargetCamera();
    const world = this.getWorld();
    if (!camNode || !world) {
      return;
    }

    this.cinematicReturningToPlayer = false;
    this.resolveOrdinanceCinematicLookAt(target, this.cinematicLookAt);

    target.getWorldQuaternion(this.tmpQuat);
    this.tmpForward.set(0, 0, 1).applyQuaternion(this.tmpQuat);
    this.tmpForward.y = 0;
    if (this.tmpForward.lengthSq() < 1e-6) {
      this.tmpForward.set(0, 0, 1);
    } else {
      this.tmpForward.normalize();
    }

    const elev = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitchFromFloorDeg, 0, 85));
    const horizontal = distance * Math.cos(elev);
    const height = distance * Math.sin(elev);
    this.cinematicEndPos
      .copy(this.cinematicLookAt)
      .addScaledVector(this.tmpForward, horizontal)
      .addScaledVector(this.upAxis, height);

    this.tmpMatrix.lookAt(this.cinematicEndPos, this.cinematicLookAt, this.upAxis);
    this.cinematicEndQuat.setFromRotationMatrix(this.tmpMatrix);

    if (immediate) {
      this.cinematicStartPos.copy(this.cinematicEndPos);
      this.cinematicStartQuat.copy(this.cinematicEndQuat);
      this.cinematicBlend = 1;
    } else if (!useCapturedStart) {
      const active = world.getActiveCamera();
      if (active) {
        active.updateMatrixWorld(true);
        active.getWorldPosition(this.cinematicStartPos);
        active.getWorldQuaternion(this.cinematicStartQuat);
      } else {
        this.cinematicStartPos.copy(this.cinematicEndPos);
        this.cinematicStartQuat.copy(this.cinematicEndQuat);
      }
      this.cinematicBlend = 0;
    } else {
      this.cinematicBlend = 0;
    }

    camNode.position.copy(immediate ? this.cinematicEndPos : this.cinematicStartPos);
    camNode.quaternion.copy(immediate ? this.cinematicEndQuat : this.cinematicStartQuat);
    camNode.updateMatrixWorld(true);
    camNode.setActive(true);
    this.cinematicActive = true;
    this.updateModelFrontCinematic(0);
  }

  /**
   * Default: model AABB center. Tall pole+board ordinances aim at the board.
   */
  private resolveOrdinanceCinematicLookAt(target: ENGINE.SceneNode, out: THREE.Vector3): void {
    this.tmpBounds.setFromObject(target);
    if (this.tmpBounds.isEmpty()) {
      target.getWorldPosition(out);
      return;
    }

    this.tmpBounds.getCenter(out);
    const name = target.name ?? '';
    if (!JAYWALKING_ANY_NAME.test(name)
      && !DO_NOT_STEP_CAR_ANY_NAME.test(name)
      && !DO_NOT_STEP_CITY_TRAM_ANY_NAME.test(name)
      && !STREET_LIGHTS_CLIMB_ANY_NAME.test(name)
      && !STREET_LIGHTS_DESTROY_ANY_NAME.test(name)
      && !DONT_FEED_THE_CAT_ANY_NAME.test(name)
      && !NO_CATS_ON_STREETS_ANY_NAME.test(name)
      && !NO_CRATES_ON_ROADS_ANY_NAME.test(name)
      && !NO_BENCH_ON_ROADS_ANY_NAME.test(name)
      && !NO_LOGS_ON_ROADS_ANY_NAME.test(name)
      && !NO_WOOD_PLANKS_ON_ROADS_ANY_NAME.test(name)
      && !DONT_REMOVE_THE_CONES_ANY_NAME.test(name)
      && !NO_SCRAP_METALS_ON_ROADS_ANY_NAME.test(name)
      && !DONT_REMOVE_THIS_BUSH_ANY_NAME.test(name)
      && !DONT_REMOVE_THIS_KIOSK_ANY_NAME.test(name)
      && !DONT_CUT_THIS_POLE_ANY_NAME.test(name)
      && !DO_NOT_DESTROY_THIS_SIGN_ANY_NAME.test(name)
      && !DONT_HIT_THE_FIRE_HYDRANT_ANY_NAME.test(name)
      && !HIGH_VOLTAGE_ANY_NAME.test(name)
      && !NO_CUTTING_OF_TREES_ANY_NAME.test(name)
      && !NO_CLIMBING_ON_THE_TREE_ANY_NAME.test(name)
      && !DO_NOT_REMOVE_THE_SIGNS_ANY_NAME.test(name)) {
      return;
    }

    // Prefer an explicit board/sign child mesh when present.
    let boardObject: THREE.Object3D | null = null;
    target.traverse((child) => {
      if (boardObject) {
        return;
      }
      const mesh = child as THREE.Mesh;
      if (!mesh.isMesh) {
        return;
      }
      const childName = child.name ?? '';
      if (/board|sign|panel|jaywalk|step|hydrant|tree|cutting|cats?/i.test(childName)) {
        boardObject = child;
      }
    });
    if (boardObject) {
      this.tmpBounds.setFromObject(boardObject);
      if (!this.tmpBounds.isEmpty()) {
        this.tmpBounds.getCenter(out);
        return;
      }
    }

    // Fallback: upper ~82% of the pole+board bounds (sign face, not pole midpoint).
    this.tmpBounds.setFromObject(target);
    out.y = THREE.MathUtils.lerp(this.tmpBounds.min.y, this.tmpBounds.max.y, 0.82);
  }

  /** Blend the view-target cam from the current shot back onto the player. */
  private beginCinematicReturnToPlayer(distance = DEFAULT_CAMERA_DISTANCE): void {
    this.cinematicReturnDistance = distance;
    if (!this.player || !this.viewTargetCam || !this.cinematicActive) {
      this.stopModelFrontCinematic();
      this.player?.resetGameplayCameraToDefault(this.cinematicReturnDistance);
      return;
    }

    // Ensure the pawn is planted before we blend onto them (avoids floater snap).
    this.player.settleOnGround();
    this.player.setMovementFrozen(true);

    this.viewTargetCam.getWorldPosition(this.cinematicStartPos);
    this.viewTargetCam.getWorldQuaternion(this.cinematicStartQuat);

    // Match gameplay cam defaults first so the blend end pose is the real free-play view.
    this.player.resetGameplayCameraToDefault(this.cinematicReturnDistance);
    this.syncCinematicReturnEndPose(false);
    this.matchCinematicFovToGameplay();

    this.cinematicReturningToPlayer = true;
    this.cinematicBlend = 0;
    this.cinematicActive = true;
  }

  private syncCinematicReturnEndPose(resetCamera = true): void {
    if (!this.player) {
      return;
    }
    if (resetCamera) {
      this.player.resetGameplayCameraToDefault(this.cinematicReturnDistance);
    }
    this.player.updateMatrixWorld(true);
    const gameplayCam = this.player.getGameplayCamera();
    if (gameplayCam) {
      gameplayCam.updateMatrixWorld(true);
      gameplayCam.getWorldPosition(this.cinematicEndPos);
      gameplayCam.getWorldQuaternion(this.cinematicEndQuat);
      return;
    }
    this.player.getWorldPosition(this.cinematicLookAt);
    this.cinematicEndPos.copy(this.cinematicLookAt);
    this.cinematicEndPos.y += 8;
    this.cinematicEndPos.z += 14;
    this.tmpMatrix.lookAt(this.cinematicEndPos, this.cinematicLookAt, this.upAxis);
    this.cinematicEndQuat.setFromRotationMatrix(this.tmpMatrix);
  }

  private matchCinematicFovToGameplay(): void {
    if (!this.viewTargetCam || !this.player) {
      return;
    }
    const gameplayCam = this.player.getGameplayCamera();
    if (gameplayCam instanceof THREE.PerspectiveCamera) {
      this.viewTargetCam.setFOV(gameplayCam.fov);
    }
  }

  /** Seamless handoff: align to gameplay pose, then drop the view-target override. */
  private finishCinematicReturnToPlayer(): void {
    if (this.cinematicReturningToPlayer) {
      this.syncCinematicReturnEndPose(false);
      if (this.viewTargetCam) {
        this.viewTargetCam.position.copy(this.cinematicEndPos);
        this.viewTargetCam.quaternion.copy(this.cinematicEndQuat);
        this.viewTargetCam.updateMatrixWorld(true);
      }
    }
    this.stopModelFrontCinematic();
    this.player?.resetGameplayCameraToDefault(this.cinematicReturnDistance);
  }

  private updateModelFrontCinematic(deltaTime: number): void {
    if (!this.cinematicActive || !this.viewTargetCam) {
      return;
    }
    if (this.cinematicReturningToPlayer) {
      // Keep the prepared gameplay end pose stable so the return blend stays smooth.
      this.syncCinematicReturnEndPose(false);
    }
    const blendSec = this.cinematicReturningToPlayer ? CINEMATIC_RETURN_SEC : CINEMATIC_BLEND_SEC;
    if (blendSec <= 0) {
      this.cinematicBlend = 1;
    } else {
      this.cinematicBlend = Math.min(1, this.cinematicBlend + deltaTime / blendSec);
    }
    const t = this.cinematicBlend;
    const eased = t * t * (3 - 2 * t);
    this.viewTargetCam.position.lerpVectors(
      this.cinematicStartPos,
      this.cinematicEndPos,
      eased,
    );
    this.viewTargetCam.quaternion.slerpQuaternions(
      this.cinematicStartQuat,
      this.cinematicEndQuat,
      eased,
    );
    this.viewTargetCam.updateMatrixWorld(true);
  }

  private stopModelFrontCinematic(): void {
    if (this.viewTargetCam?.isActive()) {
      this.viewTargetCam.setActive(false);
    }
    this.cinematicActive = false;
    this.cinematicBlend = 0;
    this.cinematicReturningToPlayer = false;
  }
}
