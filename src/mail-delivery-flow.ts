/**
 * Day-0 mail delivery tutorial → escalating road ordinances
 * (MainRoad → Maintenance, LeftSideRoad → JayWalking, Yellow Cab → Do Not Step Car,
 *  City Tram → Do Not Step City Tram, Street Lamp tops → Street Lights Climb,
 *  Cargo crates / Park Benches / Logs / Kiosk Wood / Crate Planks Drop on roads/tracks →
 *  No Crates / Bench / Logs / Wood Planks / Scrap Metals on Roads (logs and scrap metals
 *  may rest on tram track tiles); cone / bush remove →
 *  DontRemoveTheCones / DontRemoveThisBush / DontCutThisPole / Dont Destroy this Sign /
 *  Dont hit the fire hydrant / High Voltage / No cutting of trees).
 *  Wearing a bush across roads queues DontRemoveThisBush; while worn, person MainRoad/
 *  LeftSideRoad feet checks are skipped (disguise, not a walker). Fallen utility poles used
 *  as road platforms queue DontCutThisPole (standing poles never count). Dismantling the
 *  Kanji Sign queues Dont Destroy this Sign; after active, the next dismantle finishes
 *  falling before the soft-loop. Hitting a fire hydrant (axe/rock) to spray water queues
 *  Dont hit the fire hydrant; after active, water sprays ~1s before the soft-loop. Walking
 *  on utility-pole wires without tram / kanji / street-lamp / scrap platforms queues High Voltage.
 *  Delivering mail while carrying a tree log that never touched a road queues No cutting of
 *  trees; chopping a cherry tree (throw/carry logs off roads) also queues it at lower
 *  delivery-route priority. After active, cutting a tree soft-loops after the log drops appear. Axing ordinance
 *  boards replaces them with fallen dynamic prefabs (road platforms); using those platforms
 *  or dismantling boards queues Do not remove the SIGNS; after active, the next axe lets the
 *  board tip/fall before the soft-loop. Fallen boards also count as scrap metal on roads —
 *  if they hit the road before other scrap (and SIGNS is not yet active), SIGNS unlocks
 *  first; once SIGNS is active, those boards queue No Scrap Metals on Roads. Standing on
 *  street-lamp Metal Scrapt over a road without that scrap resting on asphalt queues
 *  Dont destroy the street lights; chopping a street lamp also queues it at lower
 *  delivery-route priority. Metal Scrapt resting on asphalt/side roads queues No Scrap
 *  Metals and voids the destroy route (tram track tiles are excluded). After Dont destroy is
 *  active, the next lamp dismantle soft-loops after scrap
 *  appears. Throwing a peach to lure the Cat queues Dont feed the cat; click the cat within
 *  2.5m to have it carry mail to the mailbox. After active, the next peach lure soft-loops
 *  when the cat reaches the fruit. The cat also patrols (mailbox → cherry tree → wires →
 *  shophouse roofs → back); clicking it without a peach lure queues No cats on streets
 *  (board: Cats). After that ordinance is active, clicking the unfed cat soft-loops.
 *  Climbing a standing cherry canopy (TreeTrigger) then delivering mail queues No climbing
 *  on the tree (board: Trees Climbing); after active, stepping on the canopy soft-loops.
 *  Dismantling the Trail Map Kiosk and using its wood as a platform without resting parts on
 *  asphalt roads (tram track tiles do not count) then delivering mail queues Dont remove this
 *  kiosk (board: Kiosk); after active, the next kiosk dismantle soft-loops after the parts appear.
 *
 * Flow:
 * 1. Normal gameplay camera at 20m + speech bubble for a few seconds, then playable day
 * 2. Highlight mailbox (red pulse) + arrow trail
 * 3. Player approaches and left-clicks mailbox to deliver (2.5m, green outline hover)
 * 4. Stepping on MainRoad* / LeftSideRoad* / Yellow Cab / City Tram / LampTrigger, placing a
 *    cargo crate / park bench / log / kiosk wood / crate planks / metal scrap on roads (scrap
 *    metals may rest on tram track tiles), wearing a bush across roads, using a traffic cone or fallen utility pole as a platform
 *    over a road, finishing a traffic-cone axe dismantle (5th hit), or dismantling the Kanji
 *    Sign, or releasing fire-hydrant water (axe/rock), or walking utility-pole wires without
 *    tram / kanji / street-lamp / scrap platforms, or delivering while carrying a tree log that never
 *    touched a road. Violation ordinances (roads / litter / hydrant / bush / cone axe) queue
 *    at most ONE new ordinance for the next day (first broken). Delivery-route ordinances
 *    (climbs, platforms, cat, clean log/kiosk/tree) are candidate-tracked and the successful
 *    delivery picker chooses which one unlocks — last enabling method wins, with a static
 *    priority tie-break (No cutting of trees beats High Voltage when both apply).
 * 5. After delivery: mailbox close-up + envelope insert → fade black → teleport + prop reset
 *    → "the Next Day..." → fade in on newly revealed ordinance → zoom out to player
 * 6. Later: repeating the same break focuses that ordinance + instant teleport home
 *    (no black / next day) → zoom out to player.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { createAirmailEnvelope, disposeAirmailEnvelope } from './airmail-envelope.js';
import { AxePickupRingSystem } from './axe-pickup-ring.js';
import { CatMailCourier } from './cat-mail-courier.js';
import { GameSound, MAILBOX_LATCH_VOLUME, playOrdinanceBreakError, playOrdinanceStamp, playSound, startGoldenHourAudio } from './game-audio.js';
import { HoverSilhouette } from './hover-silhouette.js';
import { ThirdPersonPlayer } from './player.js';
import { ensureOvergrownAveriaFont } from './overgrown-averia-font.js';
import {
  beginSpawnPhysicsGrace,
  isRapierSimulationPaused,
  releaseSpawnPhysicsGrace,
  SPAWN_PHYSICS_HOLD_TICKS,
} from './rapier-simulation-budget.js';
import { ShophouseCameraOcclusionSystem } from './shophouse-camera-occlusion.js';
import { applyOrdinanceSignSharpnessWhenRevealed, diagnoseVisibleMeshesMissingPosition, hideMissingPositionMeshesInWorld } from './ordinance-sign-sharpness.js';
import { waitForStartupBrushReveal } from './startup-brush-reveal.js';
import { markIntroPhysicsPrimed } from './intro-physics-gate.js';
import { TutorialKeysGuide } from './tutorial-keys-guide.js';

/** Default spring-arm distance for gameplay and opening shot. */
const DEFAULT_CAMERA_DISTANCE = 20;
const AUTHORED_AXE_NAME = /^Axe$/i;
/** Close-up cinematic distance in front of the mailbox. */
const MODEL_FOCUS_DISTANCE = 2.2;
/** Ordinance close-up at authored scale 1; larger boards multiply this. */
const ORDINANCE_FOCUS_DISTANCE_AT_SCALE_1 = 2.5;
/** Read hold after the typewriter finishes (intro + morning bubbles). */
const SPEECH_READ_HOLD_SEC = 3.5;
const ORDINANCE_FOCUS_SEC = 2;
/** Latch first, then deliver SFX — avoids overlap on envelope insert. */
const MAIL_DELIVER_SOUND_DELAY_SEC = 0.38;
/** Smooth blend from gameplay cam into model-front cinematic. */
const CINEMATIC_BLEND_SEC = 1.15;
/** Smooth blend from ordinance cinematic back to the player cam. */
const CINEMATIC_RETURN_SEC = 2.8;
const FADE_SEC = 0.85;
/** Soft-loop day reset — snappier than delivery next-day fades. */
const DAY_RESET_FADE_SEC = 0.4;
const NEXT_DAY_LABEL_SEC = 2;
const NEXT_DAY_TEXT = 'The Next Day...';
/** Cream ink on the black day-transition overlay (label text only). */
const NEXT_DAY_TEXT_CSS = '#f4f1ea';
/** Day / next-day covers stay black — cream is startup-only. */
const FADE_OVERLAY_CSS = '#000000';
/** Behind the canvas after startup (never cream during play). */
const PLAY_CONTAINER_BG_CSS = '#000000';
/**
 * GPU diagnosis: false keeps cutscene fade timing / HoldBlack staging identical
 * but forces the CSS black cover fully transparent so you can see the scene.
 * Set back to true after testing.
 */
const CUTSCENE_BLACK_FADE_VISIBLE = true;

function cutsceneFadeOpacity(requested: number): number {
  if (!CUTSCENE_BLACK_FADE_VISIBLE) {
    return 0;
  }
  return Math.max(0, Math.min(1, requested));
}
/** Keep the black overlay fully opaque briefly before fading in. */
const FADE_COVER_PRESENT_SEC = 0.12;
/** Max time to drain scrap destroys under black before parking leftovers. */
const FADE_COVER_SCRAP_MAX_WAIT_SEC = 5;
/** Brief beat after "The Next Day..." finishes typing before we dismiss it. */
const NEXT_DAY_LABEL_HOLD_SEC = 0.4;
const TYPEWRITER_CHAR_INTERVAL_SEC = 0.055;
/** Day-0 want — no ordinance spoiler. */
const INTRO_SPEECH_TEXT = 'Just get this to the box.\nHow hard can it be?';
/** Morning after the first ordinance sign is posted. */
const MORNING_SPEECH_FIRST_SIGN =
  'They closed the road overnight.\nFine. I\'ll find another way.';
/** Second next-day — same morning the axe ring starts pulsing. */
const MORNING_SPEECH_AXE =
  'The axe might open\nanother path.';
/** Third next-day. */
const MORNING_SPEECH_THIRD_SIGN =
  'They\'re posting signs faster\nthan I can walk.';
/** Recurring morning line from the fourth next-day onward. */
const MORNING_SPEECH_AGAIN = 'How do I deliver\nthis letter?';
/** Read hold after the delivery-reaction typewriter finishes. */
const DELIVERY_SPEECH_READ_HOLD_SEC = 2.5;
/** Goal shown on the left HUD counter (delivery / ordinance discovery ways). */
export const DELIVERY_WAY_GOAL = 12;
/** Every ordinance in the run — full collector completion. */
export const FULL_ORDINANCE_GOAL = 24;
/** Solid road cue after first reveal or breaking active Maintenance / Jaywalking ordinances. */
const ROAD_HIGHLIGHT_DURATION_SEC = 2;
/** Black-screen staging: hide scrap, then retire, then restore, then reveal. */
const DAY_TRANSITION_TELEPORT_SEC = 0.28;
const DAY_TRANSITION_SCRAP_RETIRE_SEC = 0.55;
/** Let renderer resource retirement settle before beginning the reset. */
const DAY_TRANSITION_WORLD_RESTORE_SEC = 1.45;
/** Cooldown between the completed world restore and ordinance reveal. */
const DAY_TRANSITION_REVEAL_COOLDOWN_SEC = 0.35;
/** Cooldown between revealing assets and starting the cinematic camera work. */
const DAY_TRANSITION_CINEMATIC_COOLDOWN_SEC = 0.35;
/** Maximum authored props restored per frame while the screen is cream. */
const DAY_TRANSITION_RESTORE_BATCH_SIZE = 4;
const DELIVER_MAX_DISTANCE = 2.5;
/** Throttle mailbox aim/hover work — every-frame raycasts hitch the camera when close. */
const MAILBOX_HOVER_INTERVAL = 0.1;
/** Moving props and player-on-prop checks stay responsive without scanning every frame. */
const DYNAMIC_PROP_POLL_INTERVAL_SEC = 1 / 30;
/** Event-driven soft-loop timers need only coarse background updates. */
const BACKGROUND_POLL_INTERVAL_SEC = 1 / 10;
/** Discover runtime-spawned ModelMeshNodes without rebuilding the registry every frame. */
const MODEL_MESH_CACHE_REFRESH_INTERVAL_SEC = 1 / 10;
/** Sticky aim: require this many consecutive misses before clearing green hover. */
const MAILBOX_HOVER_EXIT_MISSES = 3;
/** Bounds pad while hover is already active (hysteresis vs enter pad). */
const MAILBOX_AIM_ENTER_PAD = 0.35;
const MAILBOX_AIM_STICKY_PAD = 0.55;
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
/** Later-day mailbox trails auto-hide this many seconds after spawn. */
const TRAIL_AFTER_SPEECH_SEC = 5;
const TRAIL_ARROW_TEXTURE_PATH = '@project/assets/textures/mail-trail-arrow.png';
const ENVELOPE_INSERT_SEC = 2.0;
/** Extra world-Y lift so the envelope meets the mailbox slot. */
const ENVELOPE_SLOT_Y_BOOST = 0.06;
/** Mailbox close-up: camera elevation above the floor plane (degrees). */
const MAILBOX_CINEMATIC_PITCH_FROM_FLOOR_DEG = 30;
// Ordinance boards have existed in both the legacy Polyfork folder and the
// replacement OrdinanceCards folders.  Treat both as ordinance props so every
// board is hidden at boot and only revealed after its matching rule is broken.
const ORDINANCE_MODEL_PATH =
  /(?:PolyforkAssets\/Ordinances\/|(?:generated\/)?OrdinanceCards\/)/i;
const MAIN_ROAD_NAME = /^MainRoad/i;
const LEFT_SIDE_ROAD_NAME = /^LeftSideRoad/i;
const RIGHT_SIDE_ROAD_NAME = /^RightSideRoad/i;
const TRAM_TRACK_NAME = /^Tram Track/i;
const CARGO_CRATE_NAME = /^Cargo Crate(?:\s|$)/i;
/** Dismantled stone-lantern drops that may be used as road platforms. */
const SMALL_ROCK_NAME = /^Small Rock(?:\s|$)/i;
const SMALL_ROCK_MODEL = /small-rock-457be8/i;
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
/** Author-scaled MeshNode (preferred) or legacy auto SceneNode — TramTrigger, TramTrigger 02, … */
const TRAM_TRIGGER_NAME = /^TramTrigger(?:\s+\d+)?$/i;
/** Low front ramp volume — ignore when the player is on road-litter platforms. */
const TRAM_TRIGGER_SECONDARY_NAME = /^TramTrigger 02$/i;
const TRAM_ROOF_TRIGGER_NAME = /^TramRoofTrigger$/i;
const MAILBOX_NAME = /Mailbox/i;
const MAINTENANCE_NAME = /^Maintenance$/i;
const MAINTENANCE_ANY_NAME = /^Maintenance(?:\s+\d+)?$/i;
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
/** Authored street lamp roots — need collider rebuild after dismantle day reset. */
const STREET_LAMP_ROOT_NAME = /^Street Lamp(?:\s|$)/i;
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
/** Single Rocks Ordinance Board (visual: No rocks on roads). */
const NO_ROCKS_ON_ROADS_NAME = /^(?:No Rocks on Roads|Rocks Ordinance Board)$/i;
const NO_ROCKS_ON_ROADS_ANY_NAME = /^(?:No Rocks on Roads|Rocks Ordinance Board)(?:\s|$)/i;
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
  /** Successful delivery with no known ordinance — wait for mystery-win HUD choice. */
  MysteryWinHold = 'mysteryWinHold',
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
  | 'noRocksOnRoads'
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

type RoadLitterOrdinance =
  | 'noCratesOnRoads'
  | 'noBenchOnRoads'
  | 'noLogsOnRoads'
  | 'noWoodPlanksOnRoads';

type MailDeliveryVia = 'mailboxClick' | 'catUnfed' | 'catPeach';

/** Player-facing titles for broken ordinances (HUD list order). */
const ORDINANCE_DISPLAY_TITLES: Record<PendingOrdinance, string> = {
  maintenance: 'Main Road is close for maintenance.',
  jaywalking: 'No Jaywalking.',
  doNotStepCar: "Don't step on the car.",
  doNotStepTram: "Don't step on the tram.",
  streetLightsClimb: 'No climbing on Street lights.',
  dontDestroyTheStreetLights: "Don't destroy the street lights.",
  dontFeedTheCat: "Don't feed the cat.",
  noCatsOnStreets: 'No cats on streets.',
  noCratesOnRoads: 'No crates on roads.',
  noRocksOnRoads: 'No rocks on roads.',
  noBenchOnRoads: 'No bench on roads.',
  noLogsOnRoads: 'No logs on roads.',
  noWoodPlanksOnRoads: 'No wood planks on roads.',
  dontRemoveTheCones: "Don't move the traffic cones.",
  noScrapMetalsOnRoads: 'No scrap metals on roads.',
  dontRemoveThisBush: "Don't remove the bushes.",
  dontRemoveThisKiosk: "Don't remove the kiosk.",
  dontCutThisPole: "Don't cut the utility pole.",
  doNotDestroyThisSign: "Don't destroy the sign board.",
  dontHitTheFireHydrant: "Don't hit the fire hydrant.",
  highVoltage: "Don't step on electrical wires.",
  noClimbingOnTheTree: 'No climbing on trees.',
  noCuttingOfTrees: 'No cutting of trees.',
  doNotRemoveTheSigns: "Don't remove the signs.",
};

const DELIVERY_SPEECH_FIRST = 'That was easy!';
const DELIVERY_SPEECH_MYSTERY = 'Delivered.\nNo rule for that. Yet.';
const DELIVERY_SPEECH_CAT_PEACH = 'Outsourced.\nDon\'t tell the mailbox.';
const DELIVERY_SPEECH_CAT_UNFED = 'Freelance delivery.\nNo benefits.';
const DELIVERY_SPEECH_BY_ORDINANCE: Record<PendingOrdinance, string> = {
  maintenance: 'Just a tiny detour.',
  jaywalking: 'The road looks clear.',
  doNotStepCar: 'Nice little shortcut.',
  doNotStepTram: 'The tram is\nnowhere near.',
  streetLightsClimb: 'Up I go.',
  dontDestroyTheStreetLights: 'I only needed\none part.',
  dontFeedTheCat: 'That cat looks hungry.',
  noCatsOnStreets: 'That cat is my\ndelivery assistant.',
  noCratesOnRoads: 'The road has space.',
  noRocksOnRoads: 'Just one little rock.',
  noBenchOnRoads: 'Public seating.\nMobile edition.',
  noLogsOnRoads: 'That was timber,\nnot trash.',
  noWoodPlanksOnRoads: 'DIY bridge.\nVery legal.',
  dontRemoveTheCones: 'The cone won\'t mind.',
  noScrapMetalsOnRoads: 'Roadside recycling.',
  dontRemoveThisBush: 'It\'s a disguise.',
  dontRemoveThisKiosk: 'I needed the wood.',
  dontCutThisPole: 'That pole was\nin my way.',
  doNotDestroyThisSign: 'The sign was unstable.',
  dontHitTheFireHydrant: 'The water helps.',
  highVoltage: 'The wire looks sturdy.',
  noClimbingOnTheTree: 'Branches are\nnature\'s stairs.',
  noCuttingOfTrees: 'That tree needed\na trim.',
  doNotRemoveTheSigns: 'That sign was\nblocking me.',
};
const DELIVERY_SPEECH_GENERIC = [
  'Posted.\nMy conscience didn\'t.',
  'In the box.\nOut of my hands.',
  'Delivered.\nPlease don\'t make a sign.',
  'Mailbox happy.\nTown suspicious.',
] as const;

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
  /** Cached AABB / meshes so near-mailbox hover does not rebuild bounds every frame. */
  private readonly mailboxBounds = new THREE.Box3();
  private readonly mailboxCenter = new THREE.Vector3();
  private mailboxRangeRadius = DELIVER_MAX_DISTANCE;
  private mailboxMeshes: THREE.Mesh[] = [];
  private mailboxBoundsReady = false;
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
  private noRocksOnRoads: ENGINE.ModelMeshNode | null = null;
  private readonly noRocksOnRoadsOrdinances: ENGINE.ModelMeshNode[] = [];
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
  private tramTrigger02: ENGINE.SceneNode | null = null;
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
  /** Delivery succeeded with no listed ordinance matched — show mystery-win HUD. */
  private mysteryDeliveryWinPending = false;
  /** Envelope cinematic finished; HUD may open the mystery-win modal. */
  private mysteryDeliveryWinReady = false;
  /** Ordinances revealed/broken across the run, in discovery order. */
  private readonly brokenOrdinanceOrder: PendingOrdinance[] = [];
  /** Day-one mailbox trail stays up until the first delivery completes. */
  private hasCompletedFirstDelivery = false;
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
  /** No Rocks on Roads board is already in the world. */
  private noRocksOnRoadsOrdinanceActive = false;
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
  /** After wake, focus the newly revealed No Rocks on Roads ordinance once. */
  private focusNoRocksOnRoadsOnWake = false;
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
  /** World position of the small rock that last violated a road/track. */
  private readonly noRocksFocusAnchor = new THREE.Vector3();
  private hasNoRocksFocusAnchor = false;
  /**
   * A loose rock rested on a road/track today. Lowest-priority Family A vote —
   * only becomes pendingOrdinance if nothing else claimed the day.
   */
  private rocksOnRoadViolationSeen = false;
  /** Road litter seen this delivery day (prop or platform use). */
  private cratesOnRoadViolationSeen = false;
  private logsOnRoadViolationSeen = false;
  private woodPlanksOnRoadViolationSeen = false;
  private benchOnRoadViolationSeen = false;
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
  private dayTransitionTeleportDone = false;
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
  /**
   * Soft-loop / day-reset only: after ordinance focus, use a quick black fade
   * instead of camera zoom-out. Not used for delivery next-day transitions.
   */
  private blackReturnAfterOrdinanceFocus = false;
  /** Countdown after mailbox-latch before playing mail-deliver. */
  private mailDeliverSoundDelayRemaining = -1;
  /** ZoomOutToPlay uses black fade (day-reset) vs cinematic blend (other returns). */
  private zoomOutUsesBlackFade = false;
  /** The player pressed movement while the focus camera was returning. */
  private cinematicReturnInterrupted = false;
  /** Day-reset black fade: out then in. */
  private dayResetFadePhase: 'toBlack' | 'coverPresent' | 'fromBlack' | null = null;
  private dayResetFadeElapsed = 0;
  /** FadeFromBlack: canvas is showing under a still-opaque overlay. */
  private fadeUncoverArmed = false;
  private fadeCoverPresentElapsed = 0;
  private fadeUncoverElapsed = 0;
  /** While uncover waits on deferred scrap destroy under the CSS black cover. */
  private fadeCoverScrapWaitElapsed = 0;
  /** After typewriter completes, keep the day card readable briefly. */
  private nextDayLabelHoldElapsed = -1;
  /** Defer movement unfreeze until post-release physics hold ticks drain. */
  private movementUnfreezeAfterPhysicsHold = false;
  /** Rapier stepped during the loading cover so intro speech does not re-wake physics. */
  private introPhysicsPrimed = false;
  /** Avoid re-arming physics hold every frame (was freezing Rapier for entire phases). */
  private physicsGracePhase: FlowPhase | null = null;
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
  private cachedModelMeshes: ENGINE.ModelMeshNode[] = [];
  private modelMeshCacheWorld: ENGINE.World | null = null;
  private modelMeshCacheValid = false;
  private modelMeshCacheRefreshElapsed = MODEL_MESH_CACHE_REFRESH_INTERVAL_SEC;
  private dynamicPropPollElapsed = 0;
  private backgroundPollElapsed = 0;
  private readonly mailboxPulseTint = new THREE.Color();
  private readonly mailboxPulseSoft = new THREE.Color(0xff7777);
  private speechTypingText = '';
  private speechTypingElapsed = 0;
  private speechAutoHideRemaining = 0;
  /** Armed when the bubble opens; countdown starts once typing finishes. */
  private speechPendingReadHoldSec = 0;
  /** Re-plant the pawn for a few frames while physics colliders finish waking. */
  private introSettleFramesRemaining = 0;
  private nextDayTypingElapsed = 0;
  private nextDayTypingActive = false;
  private nextDayTypedCount = 0;
  /** Set only by the completed delivery transition, never by an ordinance reset loop. */
  private showPromptAfterNextDayTransition = false;
  /** After the next-day speech bubble auto-hides, pulse the ground tutorial keys. */
  private pendingTutorialKeysAfterSpeech = false;
  private outlineReady = false;
  private outlinePassEnabled = false;
  private mailboxHovered = false;
  private mailboxHoverElapsed = 0;
  private mailboxAimMissStreak = 0;
  private readonly mailboxHoverSilhouette = new HoverSilhouette();
  /** Occlusion / lamp / hydrant GPU budget while a cinematic or fade owns the screen. */
  private gpuSafeTransitionActive = false;
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
  private noRocksOnRoadsLoopTriggered = false;
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
  private conePickupBreakStung = false;
  /** Time spent wearing a bush before soft-looping DontRemoveThisBush. */
  private bushWearCarryElapsed = 0;
  private bushWearBreakStung = false;
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
  private readonly tmpTriggerBounds = new THREE.Box3();
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
  private readonly cinematicStartLookAt = new THREE.Vector3();
  private readonly cinematicEndLookAt = new THREE.Vector3();
  private readonly cinematicStartQuat = new THREE.Quaternion();
  private readonly cinematicEndQuat = new THREE.Quaternion();
  private viewTargetCam: ENGINE.ViewTargetCameraNode | null = null;
  private cinematicActive = false;
  private cinematicBlend = 0;
  /** When true, cinematic blends toward the player orbit cam instead of a model. */
  private cinematicReturningToPlayer = false;
  /**
   * Next-day zoom-out: lerp look-at + position (not quaternion slerp). Board→player
   * slerps take a harsh arc that reads as a snap at the start of the return.
   */
  private cinematicReturnUsesLookAt = false;
  private cinematicReturnDistance = DEFAULT_CAMERA_DISTANCE;
  private envelopeMesh: THREE.Mesh | null = null;
  private readonly envelopeStartPos = new THREE.Vector3();
  private readonly envelopeEndPos = new THREE.Vector3();
  private readonly envelopeQuat = new THREE.Quaternion();
  private envelopeProgress = 0;
  private envelopeStarted = false;
  /** Player quip after mailbox latch; blocks fade until read hold ends. */
  private deliveryReactionText = '';
  private deliveryReactionSpeechShown = false;
  /** Delivery caption position is fixed once so typewriter growth does not jitter. */
  private deliverySpeechBubblePositionLocked = false;
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
    onCatBeganMailboxDelivery: (via) => {
      this.claimCatDeliveryOrdinanceOnStart(via);
    },
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
  /** Standing on a park bench seat while using it as a road platform. */
  private readonly parkBenchPlatformTopYPad = 0.45;
  /** Standing on a cargo crate used as a road platform. */
  private readonly cargoCratePlatformTopYPad = 0.4;
  /** Standing on a fallen log used as a road platform. */
  private readonly carryableLogPlatformTopYPad = 0.4;
  /** Standing on kiosk wood / crate planks used as a road platform. */
  private readonly woodPlanksPlatformTopYPad = 0.4;
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
    if (!CUTSCENE_BLACK_FADE_VISIBLE) {
      console.warn(
        '[MailDeliveryFlow] Cutscene black fade is transparent (CUTSCENE_BLACK_FADE_VISIBLE=false).',
      );
    }
    const world = this.getWorld();
    if (world) {
      this.setCameraOcclusionPaused(true);
    }
    void this.startFlow();
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.stopModelFrontCinematic();
    this.endGpuSafeTransition();
    this.clearEnvelope();
    this.player?.setMailEnvelopeCarried(false);
    this.teardownUi();
    this.clearTrail();
    this.setMailboxHighlight(false);
    this.clearRoadHighlight();
    this.setMailboxHoverOutline(false);
    this.mailboxHoverSilhouette.clear();
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
    if (this.shouldPausePhysicsForTransition()) {
      if (this.physicsGracePhase !== this.phase) {
        this.physicsGracePhase = this.phase;
        beginSpawnPhysicsGrace(
          SPAWN_PHYSICS_HOLD_TICKS,
          this.shouldFullyPausePhysicsForTransition(),
        );
      }
    } else {
      this.physicsGracePhase = null;
    }

    if (this.movementUnfreezeAfterPhysicsHold && !isRapierSimulationPaused()) {
      this.player?.settleOnGround();
      this.player?.syncPhysicsBodyToPawn();
      this.player?.forceIdlePose();
      this.player?.setMovementFrozen(false);
      this.movementUnfreezeAfterPhysicsHold = false;
    }

    const world = this.getWorld();
    const shouldPollOrdinances = this.shouldPollOrdinances();
    let runDynamicPropPoll = false;
    let runBackgroundPoll = false;
    let backgroundPollDelta = 0;
    if (shouldPollOrdinances) {
      const pollDelta = Math.max(deltaTime, 0);
      this.dynamicPropPollElapsed += pollDelta;
      this.backgroundPollElapsed += pollDelta;
      this.modelMeshCacheRefreshElapsed += pollDelta;

      if (this.dynamicPropPollElapsed >= DYNAMIC_PROP_POLL_INTERVAL_SEC) {
        runDynamicPropPoll = true;
        this.dynamicPropPollElapsed %= DYNAMIC_PROP_POLL_INTERVAL_SEC;
      }
      if (this.backgroundPollElapsed >= BACKGROUND_POLL_INTERVAL_SEC) {
        runBackgroundPoll = true;
        backgroundPollDelta = this.backgroundPollElapsed;
        this.backgroundPollElapsed %= BACKGROUND_POLL_INTERVAL_SEC;
      }
      if (
        world
        && (
          !this.modelMeshCacheValid
          || this.modelMeshCacheWorld !== world
          || this.modelMeshCacheRefreshElapsed >= MODEL_MESH_CACHE_REFRESH_INTERVAL_SEC
        )
      ) {
        this.refreshModelMeshCache(world);
      }
    } else {
      this.dynamicPropPollElapsed = 0;
      this.backgroundPollElapsed = 0;
      this.modelMeshCacheValid = false;
    }
    if (world && !this.speechEl) {
      this.ensureUi(world);
      if (this.phase === FlowPhase.IntroSpeech) {
        this.showSpeechBubble(INTRO_SPEECH_TEXT, SPEECH_READ_HOLD_SEC);
      }
    }

    this.phaseElapsed += deltaTime;
    this.pulseTime += deltaTime;
    if (this.playableGraceRemaining > 0) {
      this.playableGraceRemaining = Math.max(0, this.playableGraceRemaining - deltaTime);
    }
    // Never destroy hover GPU buffers during fade/cinematic — only when playable.
    if (!this.isGpuCriticalPhase()) {
      this.mailboxHoverSilhouette.flushDeferredDestroys();
    }
    if (shouldPollOrdinances) {
      this.pollMainRoadFeetContact();
      this.pollLeftSideRoadFeetContact();
      this.pollCarRoofFeetContact();
      this.pollTramRoofFeetContact();
      this.pollLampClimbFeetContact();
      this.pollTreeClimbFeetContact();
      this.pollKioskWoodPlatformUse();
      this.pollWireWalkFeetContact();
      if (runDynamicPropPoll) {
        this.pollCargoCrateOnRoadContact();
        this.pollCargoCratePlatformRoadBypass();
        this.pollSmallRockOnRoadContact();
        this.pollParkBenchOnRoadContact();
        this.pollParkBenchPlatformRoadBypass();
        this.pollLogOnRoadContact();
        this.pollLogPlatformRoadBypass();
        this.pollWoodPlanksPropOnRoadContact();
        this.pollWoodPlanksPlatformRoadBypass();
        this.pollScrapMetalOnRoadContact();
        this.pollBushWearOnRoadContact();
        this.pollConePlatformRoadBypass();
        this.pollTrafficConeStepContact();
        this.pollFallenPolePlatformRoadBypass();
        this.pollFallenOrdinanceSignPlatformRoadBypass();
        this.pollStreetLampScrapPlatformRoadBypass();
      }
      if (runBackgroundPoll) {
        this.pollTrafficConePickupSoftLoop(backgroundPollDelta);
        this.pollBushWearSoftLoop(backgroundPollDelta);
        this.pollPoleCutSoftLoop(backgroundPollDelta);
        this.pollKanjiSignSoftLoop(backgroundPollDelta);
        this.pollFireHydrantSoftLoop(backgroundPollDelta);
        this.pollTreeCutSoftLoop(backgroundPollDelta);
        this.pollKioskDismantleSoftLoop(backgroundPollDelta);
        this.pollSignsSoftLoop(backgroundPollDelta);
        this.pollStreetLampDestroySoftLoop(backgroundPollDelta);
      }
    }
    if (!this.isGpuCriticalPhase()) {
      this.catMailCourier.tick(deltaTime);
    }
    this.updateModelFrontCinematic(deltaTime);
    this.updateEnvelopeInsert(deltaTime);
    this.tickMailDeliverSoundDelay(deltaTime);
    this.updateTypingAnimations(deltaTime);
    this.updateSpeechBubblePosition();
    this.updateTrail();
    this.updateTrailVisibility(deltaTime);
    this.updateMailboxPulse();
    this.updateRoadHighlightPulse(deltaTime);
    if (this.introSettleFramesRemaining > 0) {
      if (isRapierSimulationPaused()) {
        this.player?.settleOnGround();
      }
      this.introSettleFramesRemaining -= 1;
    }
    this.tickPhase(deltaTime);
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);
    if (
      this.baselineReinforceRemaining > 0
      && !this.isGpuCriticalPhase()
    ) {
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
      this.updateMailboxHoverOutline(deltaTime);
      // Only drain/recover when hover is live — avoids per-frame work while walking up.
      if (this.mailboxHovered) {
        this.mailboxHoverSilhouette.syncTransforms();
      }
      this.catMailCourier.tickHoverOutline();
    } else {
      this.setMailboxHoverOutline(false);
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

    if (this.player) {
      this.player.setMovementFrozen(true);
      this.player.teleportToPlayerStartAndSettle();
      this.player.setCinematicCameraLock(true);
      this.player.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
    }
    await this.primeIntroPhysicsDuringLoading();

    this.mailbox = this.findModelByName(MAILBOX_NAME);
    this.refreshMailboxCache();
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
    this.cacheNoRocksOnRoadsOrdinances();
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
    }

    // Keep the tutorial UI quiet while the opening mask reveals the world.
    // The first speech bubble appears only once the player has full view.
    await waitForStartupBrushReveal();
    startGoldenHourAudio(this.getWorld());
    this.plantPlayerForIntro();
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
        this.player?.setMovementFrozen(true);
        this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
        break;
      case FlowPhase.ZoomOutReveal: {
        // Opening no longer uses a wide establishing shot; keep this phase as a
        // safe fallback that lands on the normal 20m gameplay camera.
        if (this.player?.hasMovementInput()) {
          this.player.resetGameplayCameraToDefault(this.player.getCameraArmLength());
          this.enterPlayableDay(false, true);
          break;
        }
        this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
        this.enterPlayableDay(false);
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
        break;
      case FlowPhase.MysteryWinHold:
        this.player?.setMovementFrozen(true);
        this.player?.forceIdlePose();
        this.player?.setCinematicCameraLock(true);
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
          } else if (this.blackReturnAfterOrdinanceFocus) {
            this.blackReturnAfterOrdinanceFocus = false;
            this.zoomOutUsesBlackFade = true;
            this.dayResetFadePhase = 'toBlack';
            this.dayResetFadeElapsed = 0;
            this.fadeUncoverArmed = false;
            this.fadeUncoverElapsed = 0;
            this.fadeCoverPresentElapsed = 0;
            this.fadeCoverScrapWaitElapsed = 0;
            this.setFade(0);
            this.setPhase(FlowPhase.ZoomOutToPlay);
          } else {
            this.zoomOutUsesBlackFade = false;
            this.beginCinematicReturnToPlayer();
            this.setPhase(FlowPhase.ZoomOutToPlay);
          }
        }
        break;
      case FlowPhase.FadeToBlack: {
        this.player?.setMovementFrozen(true);
        this.player?.setAllowDeferredDestroys(false);
        const t = Math.min(1, this.phaseElapsed / FADE_SEC);
        this.setFade(t);
        if (t >= 1) {
          this.setFade(1);
          this.showPromptAfterNextDayTransition = true;
          this.showNextDayLabel(true);
          this.setPhase(FlowPhase.HoldBlack);
        }
        break;
      }
      case FlowPhase.HoldBlack:
        this.player?.setMovementFrozen(true);
        this.player?.forceIdlePose();
        this.setFade(1);
        this.applyTransitionCoverBackground(true);
        this.setRendererPresenting(true);
        this.tickDayTransitionStaging();
        if (this.isDayTransitionHoldComplete()) {
          if (!this.isNextDayLabelDismissible(_deltaTime)) {
            break;
          }
          this.showNextDayLabel(false);
          this.pendingOrdinance = null;
          this.player?.forceIdlePose();
          this.player?.setAllowDeferredDestroys(false);
          this.setPhase(FlowPhase.FadeFromBlack);
        }
        break;
      case FlowPhase.FadeFromBlack: {
        this.player?.setMovementFrozen(true);
        this.player?.forceIdlePose();
        this.player?.setAllowDeferredDestroys(false);
        this.showNextDayLabel(false);
        if (this.tickCoveredCanvasReveal(_deltaTime, FADE_SEC)) {
          this.player?.forceIdlePose();
          this.continueAfterDayReveal();
        }
        break;
      }
      case FlowPhase.NextDayLabel:
        this.showNextDayLabel(false);
        this.finishNextDayIntoPlayable();
        break;
      case FlowPhase.ZoomOutToPlay:
        if (this.zoomOutUsesBlackFade) {
          this.tickDayResetBlackFade(_deltaTime);
          break;
        }
        if (this.player?.hasMovementInput()) {
          // Keep the cinematic camera active while its target follows the live
          // gameplay camera. This lets movement interrupt the return without a
          // hard cut back to the normal spring arm.
          this.cinematicReturnInterrupted = true;
          this.player.setMovementFrozen(false);
        } else if (!this.cinematicReturnInterrupted) {
          this.player?.setMovementFrozen(true);
          this.player?.forceIdlePose();
        }
        if (!this.cinematicActive || this.cinematicBlend >= 1 || this.phaseElapsed > 5) {
          this.finishCinematicReturnToPlayer();
          // Preserve the blended 20m gameplay pose — resetting here causes an end snap.
          this.finishNextDayIntoPlayable(true);
          // Only reveal the road cue after the camera has returned to gameplay distance.
          this.beginPendingRoadHighlight();
        }
        break;
      default:
        break;
    }
  }

  private setPhase(phase: FlowPhase): void {
    if (phase === FlowPhase.OrdinanceFocus && this.phase !== FlowPhase.OrdinanceFocus) {
      // Second beat of the punchline: the board itself lands on screen.
      playSound(this.getWorld(), GameSound.OrdinanceReveal, 0.65);
    }
    if (phase === FlowPhase.FadeToBlack && this.phase !== FlowPhase.FadeToBlack) {
      this.resetDayTransitionStaging();
      this.beginGpuSafeTransition();
      this.hideEnvelopeForGpu();
    }
    this.phase = phase;
    this.phaseElapsed = 0;
    this.diagnoseMissingPositionMeshes(phase);
  }

  /** Correlate THREE.AttributeNode warnings with scene objects during cinematics. */
  private diagnoseMissingPositionMeshes(phase: FlowPhase): void {
    switch (phase) {
      case FlowPhase.DeliveryFocus:
      case FlowPhase.FadeToBlack:
      case FlowPhase.HoldBlack:
      case FlowPhase.FadeFromBlack:
      case FlowPhase.OrdinanceFocus:
      case FlowPhase.ZoomOutToPlay:
        break;
      default:
        return;
    }
    const world = this.getWorld();
    if (!world) {
      return;
    }
    hideMissingPositionMeshesInWorld(world, phase);
    diagnoseVisibleMeshesMissingPosition(world, phase);
  }

  private beginIntroSpeech(): void {
    this.stopModelFrontCinematic();
    this.plantPlayerForIntro();
    this.player?.setCinematicCameraLock(true);
    this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
    this.setPhase(FlowPhase.IntroSpeech);
    this.showSpeechBubble(INTRO_SPEECH_TEXT, SPEECH_READ_HOLD_SEC);
  }

  /** Escalating morning thoughts — one bubble per next-day. */
  private getMorningSpeechText(): string {
    const signs = this.brokenOrdinanceOrder.length;
    if (signs <= 0) {
      return INTRO_SPEECH_TEXT;
    }
    if (signs === 1) {
      return MORNING_SPEECH_FIRST_SIGN;
    }
    if (signs === 2) {
      return MORNING_SPEECH_AXE;
    }
    if (signs === 3) {
      return MORNING_SPEECH_THIRD_SIGN;
    }
    return MORNING_SPEECH_AGAIN;
  }

  /** Keep movement frozen; skip re-teleport once loading physics priming finished. */
  private plantPlayerForIntro(): void {
    if (!this.player) {
      return;
    }
    this.player.setMovementFrozen(true);
    if (this.introPhysicsPrimed) {
      this.player.forceIdlePose();
      return;
    }
    this.player.teleportToPlayerStartAndSettle({ armSpawnPhysicsGrace: false });
    this.introSettleFramesRemaining = Math.max(this.introSettleFramesRemaining, 8);
  }

  /**
   * Step Rapier under the loading / splash cover so the capsule is grounded before
   * the intro bubble ends. Movement stays frozen; hitch discard still applies.
   */
  private async primeIntroPhysicsDuringLoading(): Promise<void> {
    if (!this.player || this.introPhysicsPrimed) {
      return;
    }
    this.player.setMovementFrozen(true);
    releaseSpawnPhysicsGrace(SPAWN_PHYSICS_HOLD_TICKS);
    const frameBudget = SPAWN_PHYSICS_HOLD_TICKS * 3 + 24;
    for (let frame = 0; frame < frameBudget; frame += 1) {
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      });
      if (!isRapierSimulationPaused()) {
        this.player.syncPhysicsBodyToPawn();
        if (frame % 6 === 0) {
          this.player.settleOnGround();
        }
      }
    }
    this.player.settleOnGround();
    this.player.syncPhysicsBodyToPawn();
    this.player.forceIdlePose();
    this.introPhysicsPrimed = true;
    this.introSettleFramesRemaining = Math.max(this.introSettleFramesRemaining, 12);
    markIntroPhysicsPrimed();
  }

  private enterPlayableDay(
    resetPathUsage: boolean,
    preserveCurrentCamera = false,
    options?: { spawnTrail?: boolean },
  ): void {
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
      this.noRocksOnRoadsLoopTriggered = false;
      this.rocksOnRoadViolationSeen = false;
      this.cratesOnRoadViolationSeen = false;
      this.logsOnRoadViolationSeen = false;
      this.woodPlanksOnRoadViolationSeen = false;
      this.benchOnRoadViolationSeen = false;
      this.hasNoCratesFocusAnchor = false;
      this.hasNoBenchFocusAnchor = false;
      this.hasNoLogsFocusAnchor = false;
      this.hasNoWoodPlanksFocusAnchor = false;
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
      this.conePickupBreakStung = false;
      this.bushWearCarryElapsed = 0;
      this.bushWearBreakStung = false;
      this.poleCutSoftLoopDelayRemaining = 0;
      this.kanjiSignSoftLoopDelayRemaining = 0;
      this.fireHydrantSoftLoopDelayRemaining = 0;
      this.treeCutSoftLoopDelayRemaining = 0;
      this.signsSoftLoopDelayRemaining = 0;
      this.streetLampDestroySoftLoopDelayRemaining = 0;
      this.getWorld()?.getNodes(AxePickupRingSystem).forEach((ring) => ring.resetForNewDay());
    }
    this.stopModelFrontCinematic();
    this.playableGraceRemaining = 1.35;
    this.setMailboxHoverOutline(false);
    if (options?.spawnTrail !== false) {
      this.spawnMailboxTrail();
    } else {
      this.setMailboxHighlight(true);
    }
    this.player?.setMailEnvelopeCarried(true);
    this.player?.setMailDeliveryClickHandler(() => this.tryDeliverByClick());
    this.player?.setCinematicCameraLock(false);
    if (this.introPhysicsPrimed && !resetPathUsage) {
      // First morning after loading: physics already settled under the splash cover.
      this.player?.setMovementFrozen(false);
    } else {
      releaseSpawnPhysicsGrace(SPAWN_PHYSICS_HOLD_TICKS);
      this.movementUnfreezeAfterPhysicsHold = true;
    }
    this.endGpuSafeTransition();
    this.setCameraOcclusionPaused(false);
    // Physics settle after GPU throttle lifts — not under black fade.
    this.baselineReinforceRemaining = Math.max(this.baselineReinforceRemaining, 10);
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
    this.beginGpuSafeTransition();
    this.player?.setMovementFrozen(true);
    this.player?.setCinematicCameraLock(true);
    const target = options.target ?? this.maintenance;
    this.startOrdinanceFrontCinematic(
      target,
      false,
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
    // Cat already carrying mail — wait for arrival; do not let a mailbox click
    // resolve as a plain mailbox delivery (which can promote deferred rocks).
    if (this.catMailCourier.isDeliveringMail()) {
      return true;
    }
    // Only evaluate mailbox on click: far away → ignore (no hover/outline work).
    if (!this.isMailboxInRange()) {
      return false;
    }
    if (!this.isAimingAtMailbox()) {
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

  /** A tree log rested on a road — No logs on roads wins; cut-tree route is void. */
  private clearNoCuttingOfTreesRouteCandidate(): void {
    this.routeCandidates.delete('noCuttingOfTrees');
    this.routeCandidateAt.delete('noCuttingOfTrees');
  }

  /** Street-lamp scrap rested on a road — No scrap metals wins; destroy route is void. */
  private clearDontDestroyTheStreetLightsRouteCandidate(): void {
    this.routeCandidates.delete('dontDestroyTheStreetLights');
    this.routeCandidateAt.delete('dontDestroyTheStreetLights');
  }

  private assignPendingOrdinance(id: PendingOrdinance): void {
    if (this.pendingOrdinance === id) {
      return;
    }
    this.pendingOrdinance = id;
  }

  private markRouteCandidate(id: DeliveryRouteCandidate): void {
    if (this.isRouteOrdinanceActive(id)) {
      return;
    }
    // Bare-wire HV must not steal unlock from lamp / kanji / tram / pole / tree / kiosk…
    if (id === 'highVoltage' && this.hasWireBypassRouteCandidate()) {
      return;
    }
    // Chopping a tree outranks bare-wire walking — do not let a later wire stamp win the day.
    if (
      id === 'highVoltage'
      && this.routeCandidates.has('noCuttingOfTrees')
      && !this.noCuttingOfTreesOrdinanceActive
    ) {
      return;
    }
    if (this.isWireBypassRouteCandidate(id)) {
      this.clearHighVoltageRouteCandidate();
    }
    if (id === 'noCuttingOfTrees') {
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
      case 'dontRemoveThisKiosk':
      case 'dontDestroyTheStreetLights':
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
      case 'dontRemoveTheCones':
        return 12;
      case 'noCuttingOfTrees':
        return 13;
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
   * Claim the cat ordinance as soon as the handoff starts (not on mailbox arrival).
   * Rocks on the road stay deferred and must not beat a deliberate cat delivery.
   */
  private claimCatDeliveryOrdinanceOnStart(via: 'peach' | 'unfed'): void {
    this.deliveryVia = via === 'unfed' ? 'catUnfed' : 'catPeach';
    if (via === 'peach' && !this.dontFeedTheCatOrdinanceActive) {
      this.assignPendingOrdinance('dontFeedTheCat');
      this.rocksOnRoadViolationSeen = false;
      this.markRouteCandidate('dontFeedTheCat');
      return;
    }
    if (via === 'unfed' && !this.noCatsOnStreetsOrdinanceActive) {
      this.assignPendingOrdinance('noCatsOnStreets');
      this.rocksOnRoadViolationSeen = false;
      this.markRouteCandidate('noCatsOnStreets');
    }
  }

  /**
   * Pick at most one delivery-route ordinance after a successful mail delivery.
   * Family A pending (roads / litter / etc.) is left alone, except No Rocks on
   * Roads which is deferred until the end so any other same-day trigger wins.
   */
  private resolvePendingOrdinanceForSuccessfulDelivery(): void {
    // Cat deliveries always map to their ordinance when that board is not yet live.
    // Runs before the pending early-out so a deferred rocks flag (or provisional
    // rocks claim) cannot beat No cats / Dont feed.
    if (this.deliveryVia === 'catPeach' && !this.dontFeedTheCatOrdinanceActive) {
      this.pendingOrdinance = 'dontFeedTheCat';
      this.rocksOnRoadViolationSeen = false;
      return;
    }
    if (this.deliveryVia === 'catUnfed' && !this.noCatsOnStreetsOrdinanceActive) {
      this.pendingOrdinance = 'noCatsOnStreets';
      this.rocksOnRoadViolationSeen = false;
      return;
    }

    // Rocks never stays as a provisional claim once anything else is in play.
    if (this.pendingOrdinance === 'noRocksOnRoads') {
      this.pendingOrdinance = null;
    }

    if (this.promoteSeenRoadLitterOrdinanceAtDelivery()) {
      return;
    }

    if (this.pendingOrdinance) {
      return;
    }

    if (this.isCarryingCleanTreeLog() && !this.noCuttingOfTreesOrdinanceActive) {
      // Re-stamp so carry-to-mailbox beats an earlier chop-only mark on the same day.
      this.markRouteCandidate('noCuttingOfTrees');
    }

    const eligible = [...this.routeCandidates].filter((id) => !this.isRouteOrdinanceActive(id));
    const hasBypass = eligible.some((id) => this.isWireBypassRouteCandidate(id));
    const hvBeatenBy: DeliveryRouteCandidate[] = [
      'dontRemoveThisKiosk',
      'dontDestroyTheStreetLights',
      'noCuttingOfTrees',
    ];
    let filtered = hasBypass || eligible.some((id) => hvBeatenBy.includes(id))
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
      this.promoteDeferredRocksOrdinanceIfAlone();
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
    this.rocksOnRoadViolationSeen = false;
    this.promoteDeferredRocksOrdinanceIfAlone();
  }

  /**
   * No Rocks on Roads is the lowest-priority same-day unlock: only promote it when
   * no other Family A / delivery-route ordinance already claimed the day.
   */
  private promoteDeferredRocksOrdinanceIfAlone(): void {
    if (this.pendingOrdinance || !this.rocksOnRoadViolationSeen) {
      return;
    }
    if (this.routeCandidates.size > 0) {
      return;
    }
    if (this.noRocksOnRoadsOrdinanceActive) {
      return;
    }
    this.pendingOrdinance = 'noRocksOnRoads';
  }

  private isMailboxInRange(): boolean {
    if (!this.player || !this.mailbox) {
      return false;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    if (!this.mailboxBoundsReady) {
      this.refreshMailboxCache();
    }
    if (!this.mailboxBoundsReady) {
      this.mailbox.getWorldPosition(this.tmpMailboxPos);
      return this.tmpPlayerPos.distanceTo(this.tmpMailboxPos) <= DELIVER_MAX_DISTANCE;
    }
    return this.tmpPlayerPos.distanceTo(this.mailboxCenter) <= this.mailboxRangeRadius;
  }

  /** Cursor aims at mailbox meshes or their expanded bounds (top-down friendly). */
  private isAimingAtMailbox(options: { sticky?: boolean } = {}): boolean {
    if (!this.player || !this.mailbox) {
      return false;
    }
    const camera = this.player.getGameplayCamera();
    if (!camera) {
      return false;
    }
    this.player.getAimNdc(this.tmpNdc);
    this.raycaster.setFromCamera(this.tmpNdc, camera);
    this.raycaster.far = 40;

    if (!this.mailboxBoundsReady) {
      this.refreshMailboxCache();
    }
    // Bounds-first: cheaper and more stable for iso aim than mesh raycasts every probe.
    this.tmpBounds.copy(this.mailboxBounds);
    if (this.tmpBounds.isEmpty()) {
      this.tmpBounds.setFromCenterAndSize(this.mailboxCenter, new THREE.Vector3(1.2, 2.2, 1.2));
    } else {
      this.tmpBounds.expandByScalar(
        options.sticky ? MAILBOX_AIM_STICKY_PAD : MAILBOX_AIM_ENTER_PAD,
      );
    }
    if (this.raycaster.ray.intersectBox(this.tmpBounds, this.tmpHitPoint) !== null) {
      return true;
    }
    // Precise mesh test only when bounds miss (click / enter edge cases).
    if (this.mailboxMeshes.length > 0) {
      const hits = this.raycaster.intersectObjects(this.mailboxMeshes, true);
      if (hits.length > 0) {
        return true;
      }
    }
    return false;
  }

  private refreshMailboxCache(): void {
    this.mailboxBoundsReady = false;
    this.mailboxMeshes = [];
    this.mailboxRangeRadius = DELIVER_MAX_DISTANCE;
    if (!this.mailbox) {
      return;
    }
    this.mailbox.getWorldPosition(this.mailboxCenter);
    this.mailboxBounds.setFromObject(this.mailbox);
    this.mailboxMeshes = this.mailbox.getAllMeshes();
    if (!this.mailboxBounds.isEmpty()) {
      this.mailboxBounds.getCenter(this.mailboxCenter);
      const size = this.tmpDir;
      this.mailboxBounds.getSize(size);
      const halfSpan = 0.5 * Math.max(size.x, size.z);
      this.mailboxRangeRadius = DELIVER_MAX_DISTANCE + halfSpan;
    }
    this.mailboxBoundsReady = true;
  }

  private getDeliveryReactionText(): string {
    if (this.brokenOrdinanceOrder.length === 0) {
      return DELIVERY_SPEECH_FIRST;
    }
    if (this.mysteryDeliveryWinPending) {
      return DELIVERY_SPEECH_MYSTERY;
    }
    if (this.deliveryVia === 'catPeach') {
      return DELIVERY_SPEECH_CAT_PEACH;
    }
    if (this.deliveryVia === 'catUnfed') {
      return DELIVERY_SPEECH_CAT_UNFED;
    }
    if (this.pendingOrdinance) {
      return DELIVERY_SPEECH_BY_ORDINANCE[this.pendingOrdinance];
    }
    const genericIndex = Math.max(0, this.brokenOrdinanceOrder.length - 1)
      % DELIVERY_SPEECH_GENERIC.length;
    return DELIVERY_SPEECH_GENERIC[genericIndex] ?? DELIVERY_SPEECH_GENERIC[0];
  }

  private showDeliveryReactionSpeech(): void {
    if (this.deliveryReactionSpeechShown || !this.deliveryReactionText) {
      return;
    }
    this.deliveryReactionSpeechShown = true;
    this.showSpeechBubble(
      this.deliveryReactionText,
      DELIVERY_SPEECH_READ_HOLD_SEC,
      false,
      true,
    );
  }

  private finishDeliveryAfterReactionSpeech(): void {
    this.hideEnvelopeForGpu();
    if (this.mysteryDeliveryWinPending) {
      this.mysteryDeliveryWinReady = true;
      this.setPhase(FlowPhase.MysteryWinHold);
      return;
    }
    this.setPhase(FlowPhase.FadeToBlack);
  }

  private completeDelivery(): void {
    this.hasCompletedFirstDelivery = true;
    this.player?.setMailEnvelopeCarried(false);
    this.hideSpeechBubble();
    this.setTrailVisible(false);
    this.setMailboxHighlight(false);
    this.setMailboxHoverOutline(false);
    this.beginGpuSafeTransition();
    this.player?.setMovementFrozen(true);
    this.player?.forceIdlePose();
    this.player?.setCinematicCameraLock(true);
    this.envelopeStarted = false;
    this.deliveryReactionSpeechShown = false;
    this.clearEnvelope();
    // No known listed ordinance for this delivery → mystery / unknown win.
    this.mysteryDeliveryWinPending = this.pendingOrdinance === null;
    this.deliveryReactionText = this.getDeliveryReactionText();
    this.mysteryDeliveryWinReady = false;
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
      this.recordBrokenOrdinance('maintenance');
      this.focusOrdinanceOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'jaywalking' && !this.jaywalkingOrdinanceActive) {
      this.revealJaywalkingOrdinance();
      this.jaywalkingOrdinanceActive = true;
      this.recordBrokenOrdinance('jaywalking');
      this.focusJaywalkingOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'doNotStepCar' && !this.doNotStepCarOrdinanceActive) {
      this.revealDoNotStepCarOrdinance();
      this.doNotStepCarOrdinanceActive = true;
      this.recordBrokenOrdinance('doNotStepCar');
      this.focusDoNotStepCarOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'doNotStepTram' && !this.doNotStepTramOrdinanceActive) {
      this.revealDoNotStepCityTramOrdinance();
      this.doNotStepTramOrdinanceActive = true;
      this.recordBrokenOrdinance('doNotStepTram');
      this.focusDoNotStepTramOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'streetLightsClimb' && !this.streetLightsClimbOrdinanceActive) {
      this.revealStreetLightsClimbOrdinance();
      this.streetLightsClimbOrdinanceActive = true;
      this.recordBrokenOrdinance('streetLightsClimb');
      this.focusStreetLightsClimbOnWake = true;
      return;
    }
    if (
      this.pendingOrdinance === 'dontDestroyTheStreetLights'
      && !this.dontDestroyTheStreetLightsOrdinanceActive
    ) {
      this.revealDontDestroyTheStreetLightsOrdinance();
      this.dontDestroyTheStreetLightsOrdinanceActive = true;
      this.recordBrokenOrdinance('dontDestroyTheStreetLights');
      this.focusDontDestroyTheStreetLightsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontFeedTheCat' && !this.dontFeedTheCatOrdinanceActive) {
      this.revealDontFeedTheCatOrdinance();
      this.dontFeedTheCatOrdinanceActive = true;
      this.recordBrokenOrdinance('dontFeedTheCat');
      this.focusDontFeedTheCatOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noCatsOnStreets' && !this.noCatsOnStreetsOrdinanceActive) {
      this.revealNoCatsOnStreetsOrdinance();
      this.noCatsOnStreetsOrdinanceActive = true;
      this.recordBrokenOrdinance('noCatsOnStreets');
      this.focusNoCatsOnStreetsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noCratesOnRoads' && !this.noCratesOnRoadsOrdinanceActive) {
      this.revealNoCratesOnRoadsOrdinance();
      this.noCratesOnRoadsOrdinanceActive = true;
      this.recordBrokenOrdinance('noCratesOnRoads');
      this.focusNoCratesOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noRocksOnRoads' && !this.noRocksOnRoadsOrdinanceActive) {
      this.revealNoRocksOnRoadsOrdinance();
      this.noRocksOnRoadsOrdinanceActive = true;
      this.recordBrokenOrdinance('noRocksOnRoads');
      this.focusNoRocksOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noBenchOnRoads' && !this.noBenchOnRoadsOrdinanceActive) {
      this.revealNoBenchOnRoadsOrdinance();
      this.noBenchOnRoadsOrdinanceActive = true;
      this.recordBrokenOrdinance('noBenchOnRoads');
      this.focusNoBenchOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noLogsOnRoads' && !this.noLogsOnRoadsOrdinanceActive) {
      this.revealNoLogsOnRoadsOrdinance();
      this.noLogsOnRoadsOrdinanceActive = true;
      this.recordBrokenOrdinance('noLogsOnRoads');
      this.focusNoLogsOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noWoodPlanksOnRoads' && !this.noWoodPlanksOnRoadsOrdinanceActive) {
      this.revealNoWoodPlanksOnRoadsOrdinance();
      this.noWoodPlanksOnRoadsOrdinanceActive = true;
      this.recordBrokenOrdinance('noWoodPlanksOnRoads');
      this.focusNoWoodPlanksOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontRemoveTheCones' && !this.dontRemoveTheConesOrdinanceActive) {
      this.revealDontRemoveTheConesOrdinance();
      this.dontRemoveTheConesOrdinanceActive = true;
      this.recordBrokenOrdinance('dontRemoveTheCones');
      this.focusDontRemoveTheConesOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noScrapMetalsOnRoads' && !this.noScrapMetalsOnRoadsOrdinanceActive) {
      this.revealNoScrapMetalsOnRoadsOrdinance();
      this.noScrapMetalsOnRoadsOrdinanceActive = true;
      this.recordBrokenOrdinance('noScrapMetalsOnRoads');
      this.focusNoScrapMetalsOnRoadsOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontRemoveThisBush' && !this.dontRemoveThisBushOrdinanceActive) {
      this.revealDontRemoveThisBushOrdinance();
      this.dontRemoveThisBushOrdinanceActive = true;
      this.recordBrokenOrdinance('dontRemoveThisBush');
      this.focusDontRemoveThisBushOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontRemoveThisKiosk' && !this.dontRemoveThisKioskOrdinanceActive) {
      this.revealDontRemoveThisKioskOrdinance();
      this.dontRemoveThisKioskOrdinanceActive = true;
      this.recordBrokenOrdinance('dontRemoveThisKiosk');
      this.focusDontRemoveThisKioskOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontCutThisPole' && !this.dontCutThisPoleOrdinanceActive) {
      this.revealDontCutThisPoleOrdinance();
      this.dontCutThisPoleOrdinanceActive = true;
      this.recordBrokenOrdinance('dontCutThisPole');
      this.focusDontCutThisPoleOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'doNotDestroyThisSign' && !this.doNotDestroyThisSignOrdinanceActive) {
      this.revealDoNotDestroyThisSignOrdinance();
      this.doNotDestroyThisSignOrdinanceActive = true;
      this.recordBrokenOrdinance('doNotDestroyThisSign');
      this.focusDoNotDestroyThisSignOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'dontHitTheFireHydrant' && !this.dontHitTheFireHydrantOrdinanceActive) {
      this.revealDontHitTheFireHydrantOrdinance();
      this.dontHitTheFireHydrantOrdinanceActive = true;
      this.recordBrokenOrdinance('dontHitTheFireHydrant');
      this.focusDontHitTheFireHydrantOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'highVoltage' && !this.highVoltageOrdinanceActive) {
      this.revealHighVoltageOrdinance();
      this.highVoltageOrdinanceActive = true;
      this.recordBrokenOrdinance('highVoltage');
      this.focusHighVoltageOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noCuttingOfTrees' && !this.noCuttingOfTreesOrdinanceActive) {
      this.revealNoCuttingOfTreesOrdinance();
      this.noCuttingOfTreesOrdinanceActive = true;
      this.recordBrokenOrdinance('noCuttingOfTrees');
      this.focusNoCuttingOfTreesOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'noClimbingOnTheTree' && !this.noClimbingOnTheTreeOrdinanceActive) {
      this.revealNoClimbingOnTheTreeOrdinance();
      this.noClimbingOnTheTreeOrdinanceActive = true;
      this.recordBrokenOrdinance('noClimbingOnTheTree');
      this.focusNoClimbingOnTheTreeOnWake = true;
      return;
    }
    if (this.pendingOrdinance === 'doNotRemoveTheSigns' && !this.doNotRemoveTheSignsOrdinanceActive) {
      this.revealDoNotRemoveTheSignsOrdinance();
      this.doNotRemoveTheSignsOrdinanceActive = true;
      this.recordBrokenOrdinance('doNotRemoveTheSigns');
      this.focusDoNotRemoveTheSignsOnWake = true;
    }
  }

  private recordBrokenOrdinance(id: PendingOrdinance): void {
    if (this.brokenOrdinanceOrder.includes(id)) {
      return;
    }
    this.brokenOrdinanceOrder.push(id);
    // The punchline: a new law gets stamped into existence. Loudest cue in the mix.
    playOrdinanceStamp(this.getWorld());
  }

  /** Count of ordinances broken/revealed so far this run. */
  public getBrokenOrdinanceCount(): number {
    return this.brokenOrdinanceOrder.length;
  }

  /** Broken ordinance titles in discovery order (for the HUD list). */
  public getBrokenOrdinanceTitlesInOrder(): string[] {
    return this.brokenOrdinanceOrder.map((id) => ORDINANCE_DISPLAY_TITLES[id]);
  }

  /** True while the player can freely deliver / explore (post-intro / post-next-day). */
  public isAwaitingDelivery(): boolean {
    return this.phase === FlowPhase.AwaitingDelivery;
  }

  /** Envelope done after an unknown (no listed ordinance) successful delivery. */
  public isMysteryDeliveryWinReady(): boolean {
    return this.mysteryDeliveryWinReady && this.phase === FlowPhase.MysteryWinHold;
  }

  /** Freeze or resume the pawn while a victory / completion modal is open. */
  public setCompletionInteractionPaused(paused: boolean): void {
    this.player?.setMovementFrozen(paused);
    this.player?.setCinematicCameraLock(paused);
    if (paused) {
      this.player?.forceIdlePose();
    }
  }

  /**
   * "No sign for that" → Continue Playing advances into the next-day transition
   * (no new ordinance board; morning speech still plays).
   */
  public continueMysteryIntoNextDay(): void {
    this.mysteryDeliveryWinPending = false;
    this.mysteryDeliveryWinReady = false;
    this.setCompletionInteractionPaused(true);
    this.stopModelFrontCinematic();
    this.hideEnvelopeForGpu();
    this.player?.setMailEnvelopeCarried(false);
    this.setTrailVisible(false);
    this.setMailboxHighlight(false);
    this.setMailboxHoverOutline(false);
    this.showPromptAfterNextDayTransition = true;
    this.pendingOrdinance = null;
    this.setFade(0);
    this.setPhase(FlowPhase.FadeToBlack);
  }

  /**
   * Continue Playing from the completion panel without consuming a day.
   * The panel is an optional pause in exploration, not a next-day checkpoint.
   */
  public dismissCompletionOverlay(): void {
    this.mysteryDeliveryWinPending = false;
    this.mysteryDeliveryWinReady = false;
    this.setCompletionInteractionPaused(false);
    this.stopModelFrontCinematic();
    this.setFade(0);
    this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
    this.setPhase(FlowPhase.AwaitingDelivery);
  }

  /**
   * Escape-menu respawn: home position and default camera only — no day baseline restore.
   */
  public respawnPlayerWithoutDayReset(): void {
    this.stopModelFrontCinematic();
    this.setFade(0);
    this.player?.setCinematicCameraLock(false);
    this.player?.setMovementFrozen(true);
    this.player?.forceIdlePose();
    this.player?.teleportToPlayerStartAndSettle();
    this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
    releaseSpawnPhysicsGrace(SPAWN_PHYSICS_HOLD_TICKS);
    this.movementUnfreezeAfterPhysicsHold = true;
    if (this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech) {
      this.setPhase(FlowPhase.AwaitingDelivery);
    }
  }

  private ensureWakeOrdinanceCinematic(): void {
    if (this.cinematicActive) {
      return;
    }
    if (this.focusOrdinanceOnWake) {
      this.startOrdinanceFrontCinematic(this.maintenance, true);
      return;
    }
    if (this.focusJaywalkingOnWake) {
      this.startOrdinanceFrontCinematic(this.jaywalking, true);
      return;
    }
    if (this.focusDoNotStepCarOnWake) {
      this.startOrdinanceFrontCinematic(this.doNotStepCar, true);
      return;
    }
    if (this.focusDoNotStepTramOnWake) {
      this.startOrdinanceFrontCinematic(this.doNotStepCityTram, true);
      return;
    }
    if (this.focusStreetLightsClimbOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestStreetLightsClimb(), true);
      return;
    }
    if (this.focusDontDestroyTheStreetLightsOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestStreetLightsDestroy(), true);
      return;
    }
    if (this.focusDontFeedTheCatOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestDontFeedTheCat(), true);
      return;
    }
    if (this.focusNoCatsOnStreetsOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestNoCatsOnStreets(), true);
      return;
    }
    if (this.focusNoCratesOnRoadsOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestNoCratesOnRoads(), true);
      return;
    }
    if (this.focusNoRocksOnRoadsOnWake) {
      // Same board-face framing as Jaywalking (not the pole/prop AABB midpoint).
      this.startOrdinanceFrontCinematic(
        this.noRocksOnRoads ?? this.findNearestNoRocksOnRoads(),
        true,
      );
      return;
    }
    if (this.focusNoBenchOnRoadsOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestNoBenchOnRoads(), true);
      return;
    }
    if (this.focusNoLogsOnRoadsOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestNoLogsOnRoads(), true);
      return;
    }
    if (this.focusNoWoodPlanksOnRoadsOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestNoWoodPlanksOnRoads(), true);
      return;
    }
    if (this.focusDontRemoveTheConesOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestDontRemoveTheCones(), true);
      return;
    }
    if (this.focusNoScrapMetalsOnRoadsOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestNoScrapMetalsOnRoads(), true);
      return;
    }
    if (this.focusDontRemoveThisBushOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestDontRemoveThisBush(), true);
      return;
    }
    if (this.focusDontRemoveThisKioskOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestDontRemoveThisKiosk(), true);
      return;
    }
    if (this.focusDontCutThisPoleOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestDontCutThisPole(), true);
      return;
    }
    if (this.focusDoNotDestroyThisSignOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestDoNotDestroyThisSign(), true);
      return;
    }
    if (this.focusDontHitTheFireHydrantOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestDontHitTheFireHydrant(), true);
      return;
    }
    if (this.focusHighVoltageOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestHighVoltage(), true);
      return;
    }
    if (this.focusNoCuttingOfTreesOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestNoCuttingOfTrees(), true);
      return;
    }
    if (this.focusNoClimbingOnTheTreeOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestNoClimbingOnTheTree(), true);
      return;
    }
    if (this.focusDoNotRemoveTheSignsOnWake) {
      this.startOrdinanceFrontCinematic(this.findNearestDoNotRemoveTheSigns(), true);
    }
  }

  private revealMaintenanceBlockade(): void {
    this.setOrdinanceVisible(this.maintenance, true);
    this.setOrdinanceVisible(this.cones, true);
    for (const cone of this.trafficCones) {
      this.setOrdinanceVisible(cone, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (MAINTENANCE_ANY_NAME.test(record.node.name ?? '')) {
        this.setOrdinanceVisible(record.node, true);
      }
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

  private revealNoRocksOnRoadsOrdinance(): void {
    if (this.noRocksOnRoadsOrdinances.length === 0) {
      this.cacheNoRocksOnRoadsOrdinances();
    }
    for (const node of this.noRocksOnRoadsOrdinances) {
      this.setOrdinanceVisible(node, true);
    }
    for (const record of this.hiddenOrdinances) {
      if (NO_ROCKS_ON_ROADS_ANY_NAME.test(record.node.name ?? '')) {
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
    if (this.noRocksOnRoadsOrdinanceActive) {
      this.revealNoRocksOnRoadsOrdinance();
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

  private stingLiveOrdinanceBreak(): void {
    playOrdinanceBreakError(this.getWorld());
  }

  private triggerBlockedSoftLoop(
    target: ENGINE.ModelMeshNode | null,
    playBreakSting = true,
  ): void {
    if (playBreakSting) {
      this.stingLiveOrdinanceBreak();
    }
    this.beginImmediateSoftLoop(target);
  }

  private triggerBlockedMainRoadLoop(playBreakSting = true): void {
    this.startRoadHighlight('mainRoad');
    this.triggerBlockedSoftLoop(this.maintenance, playBreakSting);
  }

  private triggerBlockedJaywalkingLoop(playBreakSting = true): void {
    this.startRoadHighlight('leftSideRoad');
    this.triggerBlockedSoftLoop(this.jaywalking, playBreakSting);
  }

  private triggerBlockedDoNotStepCarLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.doNotStepCar, playBreakSting);
  }

  private triggerBlockedDoNotStepTramLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.doNotStepCityTram, playBreakSting);
  }

  private triggerBlockedStreetLightsClimbLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestStreetLightsClimb(), playBreakSting);
  }

  private triggerBlockedDontDestroyTheStreetLightsLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestStreetLightsDestroy(), playBreakSting);
  }

  private triggerBlockedDontFeedTheCatLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestDontFeedTheCat(), playBreakSting);
  }

  private triggerBlockedNoCatsOnStreetsLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestNoCatsOnStreets(), playBreakSting);
  }

  private triggerBlockedNoCratesOnRoadsLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestNoCratesOnRoads(), playBreakSting);
  }

  private triggerBlockedNoRocksOnRoadsLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.noRocksOnRoads ?? this.findNearestNoRocksOnRoads(), playBreakSting);
  }

  private triggerBlockedNoBenchOnRoadsLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestNoBenchOnRoads(), playBreakSting);
  }

  private triggerBlockedNoLogsOnRoadsLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestNoLogsOnRoads(), playBreakSting);
  }

  private triggerBlockedNoWoodPlanksOnRoadsLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestNoWoodPlanksOnRoads(), playBreakSting);
  }

  private triggerBlockedDontRemoveTheConesLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestDontRemoveTheCones(), playBreakSting);
  }

  private triggerBlockedNoScrapMetalsOnRoadsLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestNoScrapMetalsOnRoads(), playBreakSting);
  }

  private triggerBlockedDontRemoveThisBushLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestDontRemoveThisBush(), playBreakSting);
  }

  private triggerBlockedDontRemoveThisKioskLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestDontRemoveThisKiosk(), playBreakSting);
  }

  private triggerBlockedDontCutThisPoleLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestDontCutThisPole(), playBreakSting);
  }

  private triggerBlockedDoNotDestroyThisSignLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestDoNotDestroyThisSign(), playBreakSting);
  }

  private triggerBlockedDontHitTheFireHydrantLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestDontHitTheFireHydrant(), playBreakSting);
  }

  private triggerBlockedHighVoltageLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestHighVoltage(), playBreakSting);
  }

  private triggerBlockedNoCuttingOfTreesLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestNoCuttingOfTrees(), playBreakSting);
  }

  private triggerBlockedNoClimbingOnTheTreeLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestNoClimbingOnTheTree(), playBreakSting);
  }

  private triggerBlockedDoNotRemoveTheSignsLoop(playBreakSting = true): void {
    this.triggerBlockedSoftLoop(this.findNearestDoNotRemoveTheSigns(), playBreakSting);
  }

  /** Soft-loop: reset day state, then smoothly zoom from the player's last view onto the board. */
  private beginImmediateSoftLoop(target: ENGINE.ModelMeshNode | null): void {
    this.setMailboxHoverOutline(false);
    this.setMailboxHighlight(false);
    this.setTrailVisible(false);

    // Capture the live gameplay camera before the soft-loop reset so we don't snap.
    const active = this.getWorld()?.getActiveCamera();
    if (active) {
      active.updateMatrixWorld(true);
      active.getWorldPosition(this.cinematicStartPos);
      active.getWorldQuaternion(this.cinematicStartQuat);
    }

    // Soft-loop day reset: fade to black on the ordinance, then reset under cover.
    this.blackReturnAfterOrdinanceFocus = true;
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
      this.assignPendingOrdinance('maintenance');
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
      this.assignPendingOrdinance('jaywalking');
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

    this.claimRoadLitterOrdinanceIfEligible('noCratesOnRoads');
  }

  private onSmallRockOnRoadContact(): void {
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
      this.noRocksOnRoadsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.noRocksOnRoadsLoopTriggered
    ) {
      this.noRocksOnRoadsLoopTriggered = true;
      this.triggerBlockedNoRocksOnRoadsLoop();
      return;
    }

    // Defer claiming pendingOrdinance — rocks is lowest priority and must not
    // block other same-day discoveries (climbs, hydrant, other litter, etc.).
    if (!this.noRocksOnRoadsOrdinanceActive) {
      this.rocksOnRoadViolationSeen = true;
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

    this.claimRoadLitterOrdinanceIfEligible('noBenchOnRoads');
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

    this.claimRoadLitterOrdinanceIfEligible('noLogsOnRoads');
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

    this.claimRoadLitterOrdinanceIfEligible('noWoodPlanksOnRoads');
  }

  /**
   * @param source `platform` = stepped on / used as platform; `dismantle` = 5th axe hit.
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

    this.claimDontRemoveTheConesOrdinance(source === 'dismantle');
  }

  /** Queue DontRemoveTheCones for the next day (delivery-route + pending slot). */
  private claimDontRemoveTheConesOrdinance(force = false): void {
    this.markRouteCandidate('dontRemoveTheCones');
    if (
      force
      || !this.pendingOrdinance
      || this.pendingOrdinance === 'noRocksOnRoads'
    ) {
      this.assignPendingOrdinance('dontRemoveTheCones');
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

    // Fallen ordinance boards always belong to the Do not remove the SIGNS rule.
    // This takes precedence over No Scrap Metals both before and after the sign
    // ordinance is active; street-lamp scrap on asphalt still uses No Scrap Metals.
    if (fromFallenOrdinanceSign) {
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
      this.assignPendingOrdinance('noScrapMetalsOnRoads');
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
      this.assignPendingOrdinance('dontRemoveThisBush');
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
    this.stingLiveOrdinanceBreak();
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
    this.triggerBlockedDontCutThisPoleLoop(false);
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
        this.stingLiveOrdinanceBreak();
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
    this.triggerBlockedDoNotDestroyThisSignLoop(false);
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
        this.stingLiveOrdinanceBreak();
      }
      return;
    }

    // Rocks remain a valid standalone discovery, but the hydrant is the
    // higher-priority same-day discovery.  If both happen before delivery,
    // replace the provisional rocks queue with the hydrant ordinance.
    if (
      !this.dontHitTheFireHydrantOrdinanceActive
      && (
        !this.pendingOrdinance
        || this.pendingOrdinance === 'noRocksOnRoads'
      )
    ) {
      this.assignPendingOrdinance('dontHitTheFireHydrant');
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
    this.triggerBlockedDontHitTheFireHydrantLoop(false);
  }

  /**
   * Chopping a cherry tree queues No cutting of trees for mail delivery (throw or carry
   * logs off roads). After the ordinance is live, the next chop → delay → soft loop.
   */
  private onCherryTreeDismantled(): void {
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

    if (!this.noCuttingOfTreesOrdinanceActive) {
      this.markRouteCandidate('noCuttingOfTrees');
      return;
    }

    if (this.noCuttingOfTreesLoopTriggered) {
      return;
    }
    if (this.treeCutSoftLoopDelayRemaining > 0) {
      return;
    }
    this.treeCutSoftLoopDelayRemaining = this.treeCutSoftLoopDelaySec;
    this.stingLiveOrdinanceBreak();
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
    this.triggerBlockedNoCuttingOfTreesLoop(false);
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
    this.stingLiveOrdinanceBreak();
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
    this.triggerBlockedDontRemoveThisKioskLoop(false);
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
      // Using a board is more specific than the generic scrap-on-road rule.
      if (this.pendingOrdinance === 'noScrapMetalsOnRoads') {
        this.pendingOrdinance = null;
      }
      this.markRouteCandidate('doNotRemoveTheSigns');
      return;
    }

    if (!this.pendingOrdinance) {
      this.assignPendingOrdinance('doNotRemoveTheSigns');
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
        this.stingLiveOrdinanceBreak();
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
    this.triggerBlockedDoNotRemoveTheSignsLoop(false);
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
   * Chopping a street lamp queues Dont destroy the street lights (scrap off roads or
   * platform trick). After the ordinance is live, the next chop → delay → soft loop.
   */
  private onStreetLampDismantled(): void {
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

    if (!this.dontDestroyTheStreetLightsOrdinanceActive) {
      this.markRouteCandidate('dontDestroyTheStreetLights');
      return;
    }

    if (this.dontDestroyTheStreetLightsLoopTriggered) {
      return;
    }
    if (this.streetLampDestroySoftLoopDelayRemaining > 0) {
      return;
    }
    this.streetLampDestroySoftLoopDelayRemaining = this.streetLampDestroySoftLoopDelaySec;
    this.stingLiveOrdinanceBreak();
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
      // Drop sticky feed credit so a later click cannot mystery-win deliver.
      this.catMailCourier.clearPeachFedCredit();
      this.triggerBlockedDontFeedTheCatLoop();
      return;
    }

    if (!this.dontFeedTheCatOrdinanceActive) {
      this.markRouteCandidate('dontFeedTheCat');
    }
  }

  /**
   * Click the cat without peach-feeding it → No cats on streets.
   * After active: the next unfed click → soft-loop (consumes click; no delivery).
   * @returns true when the click was consumed and mail delivery must not start.
   */
  private onCatClickedUnfed(): boolean {
    if (this.playableGraceRemaining > 0) {
      return false;
    }
    if (
      this.phase !== FlowPhase.AwaitingDelivery
      && this.phase !== FlowPhase.ZoomOutReveal
      && this.phase !== FlowPhase.IntroSpeech
    ) {
      return false;
    }

    if (
      this.noCatsOnStreetsOrdinanceActive
      && this.phase === FlowPhase.AwaitingDelivery
      && !this.noCatsOnStreetsLoopTriggered
    ) {
      this.noCatsOnStreetsLoopTriggered = true;
      this.triggerBlockedNoCatsOnStreetsLoop();
      return true;
    }

    if (!this.noCatsOnStreetsOrdinanceActive) {
      this.markRouteCandidate('noCatsOnStreets');
    }
    return false;
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
    this.triggerBlockedDontDestroyTheStreetLightsLoop(false);
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
    // The authored roof trigger is preferred, but keep a bounds fallback just
    // like the tram.  Imported cars have occasionally had an undersized or
    // offset trigger, which meant the player could stand on the roof without
    // registering the route before delivering the letter.
    if (
      !this.isPlayerFeetInsideTriggers(this.carRoofTriggers)
      && !this.isPlayerFeetOnClimbCarRoof()
    ) {
      return;
    }
    this.onCarRoofContact();
  }

  /** Conservative fallback for a car roof trigger. */
  private isPlayerFeetOnClimbCarRoof(): boolean {
    if (!this.player || this.climbCars.length === 0) {
      return false;
    }
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;
    for (const car of this.climbCars) {
      car.updateMatrixWorld(true);
      this.tmpBounds.setFromObject(car);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      const onTopSlice =
        this.tmpPlayerPos.y >= this.tmpBounds.max.y - 0.6
        && this.tmpPlayerPos.y <= this.tmpBounds.max.y + 0.4;
      const withinRoof =
        this.tmpPlayerPos.x >= this.tmpBounds.min.x - 0.1
        && this.tmpPlayerPos.x <= this.tmpBounds.max.x + 0.1
        && this.tmpPlayerPos.z >= this.tmpBounds.min.z - 0.1
        && this.tmpPlayerPos.z <= this.tmpBounds.max.z + 0.1;
      if (onTopSlice && withinRoof) {
        return true;
      }
    }
    return false;
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
    const hitTrigger = this.findPlayerFeetTrigger(this.tramRoofTriggers);
    if (!hitTrigger) {
      return;
    }
    if (
      this.tramTrigger02
      && this.shouldSuppressTramTrigger02Contact(this.tramTrigger02)
      && (
        TRAM_TRIGGER_SECONDARY_NAME.test(hitTrigger.name ?? '')
        || this.isPlayerFeetInsideTriggers([this.tramTrigger02])
      )
    ) {
      return;
    }
    this.onTramRoofContact();
  }

  /** Logs / scrap / benches / crates / planks — TramTrigger 02 ignores these. */
  private isTramTrigger02LitterBypassProp(node: ENGINE.ModelMeshNode): boolean {
    return CARGO_CRATE_NAME.test(node.name ?? '')
      || PARK_BENCH_NAME.test(node.name ?? '')
      || this.isCarryableLogProp(node)
      || this.isWoodPlanksRoadProp(node)
      || this.isScrapMetalRoadProp(node);
  }

  /**
   * Suppress TramTrigger 02 when road litter is touching the volume or the player
   * is standing on that litter (low nose trigger overlaps debris piles).
   */
  private shouldSuppressTramTrigger02Contact(trigger: ENGINE.SceneNode): boolean {
    return this.isPlayerStandingOnTramTrigger02LitterBypass()
      || this.doesLitterPropOverlapTramTrigger(trigger);
  }

  private doesLitterPropOverlapTramTrigger(trigger: ENGINE.SceneNode): boolean {
    const world = this.getWorld();
    if (!world) {
      return false;
    }

    trigger.updateMatrixWorld(true);
    this.tmpTriggerBounds.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(1, 1, 1));
    this.tmpTriggerBounds.applyMatrix4(trigger.matrixWorld);

    for (const node of this.getModelMeshes(world)) {
      if (!this.isTramTrigger02LitterBypassProp(node)) {
        continue;
      }
      if (!node.visible || !node.parent) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }
      node.updateMatrixWorld(true);
      this.tmpBounds.setFromObject(node);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      if (this.tmpTriggerBounds.intersectsBox(this.tmpBounds)) {
        return true;
      }
    }
    return false;
  }

  /**
   * TramTrigger 02 sits low on the tram nose — feet can read "on tram" while the
   * player is actually on logs / scrap / benches / crates / planks.
   */
  private isPlayerStandingOnTramTrigger02LitterBypass(): boolean {
    if (
      this.findLitterPropPlayerIsStandingOn(
        (node) => CARGO_CRATE_NAME.test(node.name ?? ''),
        this.cargoCratePlatformTopYPad,
      )
      || this.findLitterPropPlayerIsStandingOn(
        (node) => PARK_BENCH_NAME.test(node.name ?? ''),
        this.parkBenchPlatformTopYPad,
      )
      || this.findLitterPropPlayerIsStandingOn(
        (node) => this.isCarryableLogProp(node),
        this.carryableLogPlatformTopYPad,
      )
      || this.findLitterPropPlayerIsStandingOn(
        (node) => this.isWoodPlanksRoadProp(node),
        this.woodPlanksPlatformTopYPad,
      )
      || this.findLitterPropPlayerIsStandingOn(
        (node) => this.isScrapMetalRoadProp(node),
        this.streetLampScrapPlatformTopYPad,
      )
    ) {
      return true;
    }
    return false;
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
    this.ensureRestrictedRoadCaches();
    // Tram track tiles beside lamps must not unlock Street Lights Climb.
    if (this.isPlayerFeetOnRoadTiles(this.tramTrackNodes)) {
      return;
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
   * Stand on Kiosk Wood that never rested on asphalt roads (tram tracks / wires do not count)
   * → unlock Dont remove this kiosk on the next mail delivery.
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
      || this.isPlayerStandingOnStreetLampScrap()
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

  private isRoadLitterOrdinanceActive(ordinance: RoadLitterOrdinance): boolean {
    switch (ordinance) {
      case 'noCratesOnRoads':
        return this.noCratesOnRoadsOrdinanceActive;
      case 'noBenchOnRoads':
        return this.noBenchOnRoadsOrdinanceActive;
      case 'noLogsOnRoads':
        return this.noLogsOnRoadsOrdinanceActive;
      case 'noWoodPlanksOnRoads':
        return this.noWoodPlanksOnRoadsOrdinanceActive;
      default: {
        const _exhaustive: never = ordinance;
        return _exhaustive;
      }
    }
  }

  private markRoadLitterViolationSeen(ordinance: RoadLitterOrdinance): void {
    switch (ordinance) {
      case 'noCratesOnRoads':
        this.cratesOnRoadViolationSeen = true;
        break;
      case 'noBenchOnRoads':
        this.benchOnRoadViolationSeen = true;
        break;
      case 'noLogsOnRoads':
        this.logsOnRoadViolationSeen = true;
        break;
      case 'noWoodPlanksOnRoads':
        this.woodPlanksOnRoadViolationSeen = true;
        break;
      default: {
        const _exhaustive: never = ordinance;
        return _exhaustive;
      }
    }
  }

  private claimRoadLitterOrdinanceIfEligible(ordinance: RoadLitterOrdinance): void {
    if (this.isRoadLitterOrdinanceActive(ordinance)) {
      return;
    }
    this.markRoadLitterViolationSeen(ordinance);
    if (!this.pendingOrdinance) {
      this.assignPendingOrdinance(ordinance);
    } else if (this.pendingOrdinance === 'noRocksOnRoads') {
      this.assignPendingOrdinance(ordinance);
    }
  }

  /** Recover road-litter unlock when delivery runs but only rocks blocked the queue. */
  private promoteSeenRoadLitterOrdinanceAtDelivery(): boolean {
    const candidates: Array<[boolean, RoadLitterOrdinance]> = [
      [this.cratesOnRoadViolationSeen, 'noCratesOnRoads'],
      [this.logsOnRoadViolationSeen, 'noLogsOnRoads'],
      [this.woodPlanksOnRoadViolationSeen, 'noWoodPlanksOnRoads'],
      [this.benchOnRoadViolationSeen, 'noBenchOnRoads'],
    ];
    for (const [seen, ordinance] of candidates) {
      if (seen && !this.isRoadLitterOrdinanceActive(ordinance)) {
        this.pendingOrdinance = ordinance;
        this.rocksOnRoadViolationSeen = false;
        return true;
      }
    }
    return false;
  }

  private isPlayerElevatedOverRestrictedRoad(): boolean {
    if (!this.player) {
      return false;
    }
    this.ensureRestrictedRoadCaches();
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    const overRoad = this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.mainRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.leftSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.rightSideRoadNodes)
      || this.isPointXZOnRoadTiles(this.tmpPlayerPos, this.tramTrackNodes);
    if (!overRoad) {
      return false;
    }

    return !(
      this.isPlayerFeetOnRoadTiles(this.mainRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.leftSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.rightSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.tramTrackNodes)
    );
  }

  /** Like elevated-over-restricted, but tram track tiles do not count. */
  private isPlayerElevatedOverAsphaltRoad(): boolean {
    if (!this.player) {
      return false;
    }
    this.ensureRestrictedRoadCaches();
    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    if (!this.isPointXZOnAsphaltRoadTiles(this.tmpPlayerPos)) {
      return false;
    }

    return !this.isPlayerFeetOnAsphaltRoadTiles();
  }

  private findLitterPropPlayerIsStandingOn(
    matches: (node: ENGINE.ModelMeshNode) => boolean,
    topYPad: number,
  ): ENGINE.ModelMeshNode | null {
    if (!this.player) {
      return null;
    }

    const world = this.getWorld();
    if (!world) {
      return null;
    }

    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    for (const node of this.getModelMeshes(world)) {
      if (!matches(node)) {
        continue;
      }
      if (!node.visible || !node.parent) {
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
      this.tmpBounds.max.y += topYPad;
      if (this.tmpBounds.containsPoint(this.tmpPlayerPos)) {
        return node;
      }
    }
    return null;
  }

  private pollRoadLitterPlatformBypass(
    findProp: () => ENGINE.ModelMeshNode | null,
    onContact: () => void,
    setFocusAnchor: (prop: ENGINE.ModelMeshNode) => void,
  ): void {
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

    const prop = findProp();
    if (!prop || !this.isPlayerElevatedOverRestrictedRoad()) {
      return;
    }

    setFocusAnchor(prop);
    onContact();
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

    for (const node of this.getModelMeshes(world)) {
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

  /** Standing on a cargo crate over a road/track without feet on asphalt. */
  private pollCargoCratePlatformRoadBypass(): void {
    this.pollRoadLitterPlatformBypass(
      () => this.findLitterPropPlayerIsStandingOn(
        (node) => CARGO_CRATE_NAME.test(node.name ?? ''),
        this.cargoCratePlatformTopYPad,
      ),
      () => this.onCargoCrateOnRoadContact(),
      (crate) => {
        crate.getWorldPosition(this.noCratesFocusAnchor);
        this.hasNoCratesFocusAnchor = true;
      },
    );
  }

  /** Queue the ordinance only after a loose small rock has come to rest on a road/track. */
  private pollSmallRockOnRoadContact(): void {
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

    for (const node of this.getModelMeshes(world)) {
      const name = node.name ?? '';
      const modelUrl = node.modelUrl ?? '';
      if (!SMALL_ROCK_NAME.test(name) && !SMALL_ROCK_MODEL.test(modelUrl)) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }
      if (!this.isPropRestingOnRestrictedRoadSurface(node)) {
        continue;
      }

      node.getWorldPosition(this.noRocksFocusAnchor);
      this.hasNoRocksFocusAnchor = true;
      this.onSmallRockOnRoadContact();
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

    for (const node of this.getModelMeshes(world)) {
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

  /**
   * Standing on a park bench while XZ is over a road/track — the usual delivery
   * route when a bench is used as a mobile platform (prop-on-road AABB can miss).
   */
  private pollParkBenchPlatformRoadBypass(): void {
    this.pollRoadLitterPlatformBypass(
      () => this.findLitterPropPlayerIsStandingOn(
        (node) => PARK_BENCH_NAME.test(node.name ?? ''),
        this.parkBenchPlatformTopYPad,
      ),
      () => this.onParkBenchOnRoadContact(),
      (bench) => {
        bench.getWorldPosition(this.noBenchFocusAnchor);
        this.hasNoBenchFocusAnchor = true;
      },
    );
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
    for (const node of this.getModelMeshes(world)) {
      if (!this.isCarryableLogProp(node)) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }

      if (!this.isPropRestingOnAsphaltRoadSurface(node)) {
        continue;
      }

      node.getWorldPosition(this.noLogsFocusAnchor);
      this.hasNoLogsFocusAnchor = true;
      this.logsThatTouchedRoad.add(node);
      this.clearNoCuttingOfTreesRouteCandidate();
      this.onLogOnRoadContact();
      return;
    }
  }

  /** Standing on a fallen log over asphalt without feet on the road (tram tracks do not count). */
  private pollLogPlatformRoadBypass(): void {
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

    const log = this.findLitterPropPlayerIsStandingOn(
      (node) => this.isCarryableLogProp(node),
      this.carryableLogPlatformTopYPad,
    );
    if (!log || !this.isPlayerElevatedOverAsphaltRoad()) {
      return;
    }
    if (!this.isPropRestingOnAsphaltRoadSurface(log)) {
      return;
    }

    log.getWorldPosition(this.noLogsFocusAnchor);
    this.hasNoLogsFocusAnchor = true;
    this.logsThatTouchedRoad.add(log);
    this.clearNoCuttingOfTreesRouteCandidate();
    this.onLogOnRoadContact();
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

    for (const node of this.getModelMeshes(world)) {
      if (!this.isWoodPlanksRoadProp(node)) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }

      const onRoad = this.isKioskWoodProp(node)
        ? this.isPropRestingOnAsphaltRoadSurface(node)
        : this.isPropRestingOnRestrictedRoadSurface(node);
      if (!onRoad) {
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

  /** Standing on kiosk wood / crate planks over a road/track without feet on asphalt. */
  private pollWoodPlanksPlatformRoadBypass(): void {
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

    const prop = this.findLitterPropPlayerIsStandingOn(
      (node) => this.isWoodPlanksRoadProp(node),
      this.woodPlanksPlatformTopYPad,
    );
    if (!prop || !this.isPlayerElevatedOverRestrictedRoad()) {
      return;
    }

    // Kiosk wood over tram tracks / wires is Dont remove this kiosk — not wood-planks litter.
    if (this.isKioskWoodProp(prop) && !this.isPropRestingOnAsphaltRoadSurface(prop)) {
      return;
    }

    if (this.isKioskWoodProp(prop)) {
      this.kioskWoodThatTouchedRoad.add(prop);
    }

    prop.getWorldPosition(this.noWoodPlanksFocusAnchor);
    this.hasNoWoodPlanksFocusAnchor = true;
    this.onKioskWoodOnRoadContact();
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

    for (const node of this.getModelMeshes(world)) {
      if (!this.isScrapMetalRoadProp(node)) {
        continue;
      }
      if (this.player?.isCarryingObject(node)) {
        continue;
      }

      const fromFallenOrdinanceSign = this.isFallenOrdinanceSignScrapProp(node);
      const onRestrictedRoad = fromFallenOrdinanceSign
        ? this.isPropRestingOnRestrictedRoadSurface(node)
        : this.isPropRestingOnAsphaltRoadSurface(node);
      if (!onRestrictedRoad) {
        continue;
      }

      if (STREET_LAMP_SCRAP_PLATFORM_NAME.test(node.name ?? '')) {
        this.clearDontDestroyTheStreetLightsRouteCandidate();
      }

      node.getWorldPosition(this.noScrapMetalsFocusAnchor);
      this.hasNoScrapMetalsFocusAnchor = true;
      this.onScrapMetalOnRoadContact(fromFallenOrdinanceSign);
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
   * (Elevated cone platform — e.g. cone on crate over a lane.)
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
   * Stepping on a traffic cone at road level (maintenance blockade cones on asphalt).
   * Does not require feet-off-asphalt — that check blocked cones sitting on the road.
   */
  private pollTrafficConeStepContact(): void {
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

    if (this.platformTrafficCones.length === 0) {
      this.cachePlatformTrafficCones();
    }

    if (!this.isPlayerStandingOnTrafficCone()) {
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
    // Fallen poles spawn mid-day — refresh the derived list at the 30 Hz prop cadence.
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
    // Fallen boards spawn mid-day — refresh the derived list at the 30 Hz prop cadence.
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
   * If the scrap is on asphalt/side roads, pollScrapMetalOnRoadContact handles
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
    // Lamp scrap spawns mid-day — refresh the derived list at the 30 Hz prop cadence.
    this.cachePlatformStreetLampScraps();

    const scrap = this.findStreetLampScrapPlayerIsStandingOn();
    if (!scrap) {
      return;
    }
    // Scrap touching asphalt/side roads → No Scrap Metals only (not this ordinance).
    // Tram track tiles are excluded — scrap over tracks can still queue destroy.
    if (this.isPropRestingOnAsphaltRoadSurface(scrap)) {
      return;
    }

    this.player.getWorldPosition(this.tmpPlayerPos);
    this.tmpPlayerPos.y -= this.pawnFeetBelowRoot;

    const overRoad = this.isPointXZOnAsphaltRoadTiles(this.tmpPlayerPos);
    if (!overRoad) {
      return;
    }

    if (this.isPlayerFeetOnAsphaltRoadTiles()) {
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
      this.conePickupBreakStung = false;
      return;
    }

    if (!this.conePickupBreakStung) {
      this.conePickupBreakStung = true;
      this.stingLiveOrdinanceBreak();
    }

    this.conePickupCarryElapsed += deltaTime;
    if (this.conePickupCarryElapsed < this.conePickupSoftLoopDelaySec) {
      return;
    }

    this.conePickupCarryElapsed = 0;
    this.conePickupBreakStung = false;
    this.dontRemoveTheConesLoopTriggered = true;
    this.triggerBlockedDontRemoveTheConesLoop(false);
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
      this.bushWearBreakStung = false;
      return;
    }

    if (!this.bushWearBreakStung) {
      this.bushWearBreakStung = true;
      this.stingLiveOrdinanceBreak();
    }

    this.bushWearCarryElapsed += deltaTime;
    if (this.bushWearCarryElapsed < this.bushWearSoftLoopDelaySec) {
      return;
    }

    this.bushWearCarryElapsed = 0;
    this.bushWearBreakStung = false;
    this.dontRemoveThisBushLoopTriggered = true;
    this.triggerBlockedDontRemoveThisBushLoop(false);
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
    const feetX = this.tmpPlayerPos.x;
    const feetY = this.tmpPlayerPos.y;
    const feetZ = this.tmpPlayerPos.z;
    const xzPad = 0.32;

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
      const topY = this.tmpBounds.max.y + this.conePlatformTopYPad;
      const bottomY = this.tmpBounds.min.y - 0.12;
      if (feetY > topY || feetY < bottomY) {
        continue;
      }
      if (
        feetX >= this.tmpBounds.min.x - xzPad
        && feetX <= this.tmpBounds.max.x + xzPad
        && feetZ >= this.tmpBounds.min.z - xzPad
        && feetZ <= this.tmpBounds.max.z + xzPad
      ) {
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

  /** Kiosk Wood underfoot that has never rested on asphalt roads (tram tracks excluded). */
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

    for (const node of this.getModelMeshes(world)) {
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
    return this.isPropRestingOnRoadSamples(
      prop,
      (worldPoint) => this.isPropSampleOnRestrictedRoads(worldPoint),
    );
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

  /** Main / side roads only — tram track tiles are not restricted for scrap or street-lamp rules. */
  private isPropSampleOnAsphaltRoads(worldPoint: THREE.Vector3): boolean {
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
      );
  }

  private isPropRestingOnRoadSamples(
    prop: ENGINE.ModelMeshNode,
    sampleRoad: (worldPoint: THREE.Vector3) => boolean,
  ): boolean {
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

    const prevBottomY = this.propPrevBottomY.get(prop.uuid);
    this.propPrevBottomY.set(prop.uuid, bottomY);
    if (prevBottomY === undefined) {
      return false;
    }
    const verticalSpeed = Math.abs((bottomY - prevBottomY) / this.lastPrePhysicsDeltaTime);
    if (verticalSpeed > this.propRoadMaxVerticalSpeed) {
      return false;
    }

    for (let ix = 0; ix < 5; ix += 1) {
      for (let iz = 0; iz < 5; iz += 1) {
        this.tmpHitPoint.set(
          THREE.MathUtils.lerp(minX, maxX, ix / 4),
          bottomY,
          THREE.MathUtils.lerp(minZ, maxZ, iz / 4),
        );
        if (sampleRoad(this.tmpHitPoint)) {
          return true;
        }
      }
    }
    return false;
  }

  private isPropRestingOnAsphaltRoadSurface(prop: ENGINE.ModelMeshNode): boolean {
    return this.isPropRestingOnRoadSamples(
      prop,
      (worldPoint) => this.isPropSampleOnAsphaltRoads(worldPoint),
    );
  }

  private isPointXZOnAsphaltRoadTiles(worldPoint: THREE.Vector3): boolean {
    return this.isPointXZOnRoadTiles(worldPoint, this.mainRoadNodes)
      || this.isPointXZOnRoadTiles(worldPoint, this.leftSideRoadNodes)
      || this.isPointXZOnRoadTiles(worldPoint, this.rightSideRoadNodes);
  }

  private isPlayerFeetOnAsphaltRoadTiles(): boolean {
    return this.isPlayerFeetOnRoadTiles(this.mainRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.leftSideRoadNodes)
      || this.isPlayerFeetOnRoadTiles(this.rightSideRoadNodes);
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
    for (const node of this.getModelMeshes(world)) {
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
    this.tramTrigger02 = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of this.getModelMeshes(world)) {
      if (!CITY_TRAM_NAME.test(node.name ?? '')) {
        continue;
      }
      this.cityTrams.push(node);
      for (const child of node.children) {
        if (!(child instanceof ENGINE.SceneNode) || !TRAM_TRIGGER_NAME.test(child.name ?? '')) {
          continue;
        }
        // Author-scaled TramTrigger mesh only — never rewrite position/scale.
        if (!child.isHiddenInGame()) {
          child.visible = false;
        }
        if (child instanceof ENGINE.PrimitiveNode) {
          const physics = child.getPhysicsOptions();
          if (physics.enabled !== false) {
            child.overridePhysicsOptions({ enabled: false });
          }
        }
        if (TRAM_TRIGGER_SECONDARY_NAME.test(child.name ?? '')) {
          this.tramTrigger02 = child;
        }
        this.tramRoofTriggers.push(child);
      }
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
      if (!STREET_LIGHTS_DESTROY_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.streetLightsDestroyOrdinances.push(node);
    }
    this.streetLightsDestroy = this.streetLightsDestroyOrdinances.find(
      (node) => STREET_LIGHTS_DESTROY_NAME.test(node.name ?? ''),
    ) ?? this.streetLightsDestroyOrdinances[0] ?? null;
  }

  /**
   * Pole-mounted destroy boards stay in the tree when a lamp is yanked for scrap.
   * Skip hidden hosts so the soft-loop camera frames a live sign, not the chop site.
   */
  private isStreetLightsDestroyBoardFocusable(board: ENGINE.ModelMeshNode): boolean {
    if (!board.parent) {
      return false;
    }
    let current: ENGINE.SceneNode | null = board;
    while (current) {
      if (!current.visible) {
        return false;
      }
      current = current.parent as ENGINE.SceneNode | null;
    }
    return true;
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
      return this.streetLightsDestroyOrdinances.find(
        (node) => this.isStreetLightsDestroyBoardFocusable(node),
      ) ?? this.streetLightsDestroy;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.streetLightsDestroyOrdinances) {
      if (!this.isStreetLightsDestroyBoardFocusable(node)) {
        continue;
      }
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    if (best) {
      return best;
    }
    return this.streetLightsDestroyOrdinances.find(
      (node) => this.isStreetLightsDestroyBoardFocusable(node),
    ) ?? this.streetLightsDestroy;
  }

  private cacheDontFeedTheCatOrdinances(): void {
    this.dontFeedTheCatOrdinances.length = 0;
    this.dontFeedTheCat = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
      if (!NO_CRATES_ON_ROADS_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noCratesOnRoadsOrdinances.push(node);
    }
    this.noCratesOnRoads = this.noCratesOnRoadsOrdinances.find(
      (node) => NO_CRATES_ON_ROADS_NAME.test(node.name ?? ''),
    ) ?? this.noCratesOnRoadsOrdinances[0] ?? null;
  }

  private cacheNoRocksOnRoadsOrdinances(): void {
    this.noRocksOnRoadsOrdinances.length = 0;
    this.noRocksOnRoads = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of this.getModelMeshes(world)) {
      if (!NO_ROCKS_ON_ROADS_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noRocksOnRoadsOrdinances.push(node);
    }
    this.noRocksOnRoads = this.noRocksOnRoadsOrdinances.find(
      (node) => NO_ROCKS_ON_ROADS_NAME.test(node.name ?? ''),
    ) ?? this.noRocksOnRoadsOrdinances[0] ?? null;
  }

  /** Prefer the Rocks board nearest the offending loose rock (else player). */
  private findNearestNoRocksOnRoads(): ENGINE.ModelMeshNode | null {
    if (this.noRocksOnRoadsOrdinances.length === 0) {
      this.cacheNoRocksOnRoadsOrdinances();
    }
    if (this.noRocksOnRoadsOrdinances.length === 0) {
      return this.noRocksOnRoads;
    }

    if (this.hasNoRocksFocusAnchor) {
      this.tmpPlayerPos.copy(this.noRocksFocusAnchor);
    } else if (this.player) {
      this.player.getWorldPosition(this.tmpPlayerPos);
    } else {
      return this.noRocksOnRoads;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noRocksOnRoadsOrdinances) {
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    return best ?? this.noRocksOnRoads;
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
      if (!NO_CUTTING_OF_TREES_ANY_NAME.test(node.name ?? '')) {
        continue;
      }
      this.noCuttingOfTreesOrdinances.push(node);
    }
    this.noCuttingOfTrees = this.noCuttingOfTreesOrdinances.find(
      (node) => NO_CUTTING_OF_TREES_NAME.test(node.name ?? ''),
    ) ?? this.noCuttingOfTreesOrdinances[0] ?? null;
  }

  private isTreeOrdinanceBoardFocusable(board: ENGINE.ModelMeshNode): boolean {
    if (!board.parent) {
      return false;
    }
    let current: ENGINE.SceneNode | null = board;
    while (current) {
      if (!current.visible) {
        return false;
      }
      current = current.parent as ENGINE.SceneNode | null;
    }
    return true;
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
      return this.noCuttingOfTreesOrdinances.find(
        (node) => this.isTreeOrdinanceBoardFocusable(node),
      ) ?? this.noCuttingOfTrees;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noCuttingOfTreesOrdinances) {
      if (!this.isTreeOrdinanceBoardFocusable(node)) {
        continue;
      }
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    if (best) {
      return best;
    }
    return this.noCuttingOfTreesOrdinances.find(
      (node) => this.isTreeOrdinanceBoardFocusable(node),
    ) ?? this.noCuttingOfTrees;
  }

  private cacheNoClimbingOnTheTreeOrdinances(): void {
    this.noClimbingOnTheTreeOrdinances.length = 0;
    this.noClimbingOnTheTree = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of this.getModelMeshes(world)) {
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
      return this.noClimbingOnTheTreeOrdinances.find(
        (node) => this.isTreeOrdinanceBoardFocusable(node),
      ) ?? this.noClimbingOnTheTree;
    }

    let best: ENGINE.ModelMeshNode | null = null;
    let bestDistSq = Infinity;
    for (const node of this.noClimbingOnTheTreeOrdinances) {
      if (!this.isTreeOrdinanceBoardFocusable(node)) {
        continue;
      }
      node.getWorldPosition(this.tmpMailboxPos);
      const distSq = this.tmpPlayerPos.distanceToSquared(this.tmpMailboxPos);
      if (distSq < bestDistSq) {
        bestDistSq = distSq;
        best = node;
      }
    }
    if (best) {
      return best;
    }
    return this.noClimbingOnTheTreeOrdinances.find(
      (node) => this.isTreeOrdinanceBoardFocusable(node),
    ) ?? this.noClimbingOnTheTree;
  }

  private cacheDoNotRemoveTheSignsOrdinances(): void {
    this.doNotRemoveTheSignsOrdinances.length = 0;
    this.doNotRemoveTheSigns = null;
    const world = this.getWorld();
    if (!world) {
      return;
    }
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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
    for (const node of this.getModelMeshes(world)) {
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

    if (visible && node instanceof ENGINE.ModelMeshNode) {
      applyOrdinanceSignSharpnessWhenRevealed(node);
    }

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
    for (const node of this.getModelMeshes(world)) {
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
      enabled: false,
      edgeStrength: 2.5,
      edgeThickness: 1.75,
      visibleEdgeColor: OUTLINE_GREEN,
      hiddenEdgeColor: OUTLINE_GREEN,
      showHiddenEdge: false,
      useRootGrouping: true,
      edgeBlur: 0,
    });
    this.outlineReady = true;
    this.outlinePassEnabled = false;
  }

  private setOutlinePassEnabled(world: ENGINE.World, enabled: boolean): void {
    this.ensureGreenOutline(world);
    if (this.outlinePassEnabled === enabled) {
      return;
    }
    world.postProcessManager.configureEffect(ENGINE.PostProcessPass.ObjectOutline, {
      enabled,
      edgeStrength: 2.5,
      edgeThickness: 1.75,
      visibleEdgeColor: OUTLINE_GREEN,
      hiddenEdgeColor: OUTLINE_GREEN,
      showHiddenEdge: false,
      useRootGrouping: true,
      edgeBlur: 0,
    });
    this.outlinePassEnabled = enabled;
  }

  private updateMailboxHoverOutline(deltaTime: number): void {
    if (this.phase !== FlowPhase.AwaitingDelivery) {
      this.setMailboxHoverOutline(false);
      return;
    }
    // Far away: clear immediately, no aim work.
    if (!this.isMailboxInRange()) {
      this.mailboxHoverElapsed = 0;
      this.mailboxAimMissStreak = 0;
      this.setMailboxHoverOutline(false);
      return;
    }

    this.mailboxHoverElapsed += deltaTime;
    if (this.mailboxHoverElapsed < MAILBOX_HOVER_INTERVAL) {
      return;
    }
    this.mailboxHoverElapsed = 0;

    const aiming = this.isAimingAtMailbox({ sticky: this.mailboxHovered });
    if (aiming) {
      this.mailboxAimMissStreak = 0;
      this.setMailboxHoverOutline(true);
      return;
    }
    // Hysteresis: iso aim flickers at the mailbox silhouette edge; do not
    // thrash green material swaps every probe (reads as camera hitch).
    this.mailboxAimMissStreak += 1;
    if (!this.mailboxHovered || this.mailboxAimMissStreak >= MAILBOX_HOVER_EXIT_MISSES) {
      this.setMailboxHoverOutline(false);
    }
  }

  private setMailboxHoverOutline(enabled: boolean): void {
    if (this.mailboxHovered === enabled) {
      return;
    }
    this.mailboxHovered = enabled;
    if (!enabled) {
      this.mailboxAimMissStreak = 0;
    }
    const world = this.getWorld();
    if (!world || !this.mailbox) {
      this.mailboxHoverSilhouette.setTarget(null, null);
      return;
    }
    this.mailboxHoverSilhouette.setTarget(world, enabled ? this.mailbox : null);
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
    // Green hover owns mailbox materials while aimed — skip red pulse writes so
    // the two systems do not fight (material thrash → frame hitch near the box).
    if (this.mailboxHovered) {
      return;
    }
    if (this.mailboxPulseRecords.length === 0) {
      this.applyMailboxPulseMaterials();
      if (this.mailboxPulseRecords.length === 0) {
        return;
      }
    }
    const pulse = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(this.pulseTime * 4.5));
    this.mailboxPulseTint.copy(HIGHLIGHT_RED).lerp(this.mailboxPulseSoft, pulse);
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
        m.color?.copy(this.mailboxPulseTint);
        if (m.emissive) {
          m.emissive.copy(HIGHLIGHT_EMISSIVE).multiplyScalar(0.55 + pulse * 0.9);
          if (typeof m.emissiveIntensity === 'number') {
            m.emissiveIntensity = 0.55 + pulse * 1.6;
          }
        }
      }
    }
  }

  /** Refresh the shared registry at 10 Hz so runtime-spawned props appear promptly. */
  private refreshModelMeshCache(world: ENGINE.World): void {
    this.cachedModelMeshes = world.getNodes(ENGINE.ModelMeshNode);
    this.modelMeshCacheWorld = world;
    this.modelMeshCacheValid = true;
    this.modelMeshCacheRefreshElapsed = 0;
  }

  private getModelMeshes(world: ENGINE.World): ENGINE.ModelMeshNode[] {
    if (!this.modelMeshCacheValid || this.modelMeshCacheWorld !== world) {
      this.refreshModelMeshCache(world);
    }
    return this.cachedModelMeshes;
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

  /** Show the mailbox trail; day one persists until delivery, later days auto-hide. */
  private spawnMailboxTrail(): void {
    this.trailVisibleRemaining = this.hasCompletedFirstDelivery
      ? TRAIL_AFTER_SPEECH_SEC
      : Number.POSITIVE_INFINITY;
    this.setTrailVisible(true);
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
        'background:#f4f1ea',
        'border:1px solid #c8c2b8',
        'color:#6b6560',
        'font:700 16px/1.35 "Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
        'box-shadow:0 8px 22px rgba(74,70,63,0.18)',
        'pointer-events:none',
        'white-space:pre-line',
        'text-align:center',
        'display:none',
        'z-index:2000',
        'max-width:min(420px,80vw)',
      ].join(';');
      const tail = document.createElement('div');
      tail.dataset.speechTail = '1';
      tail.style.cssText = [
        'position:absolute',
        'left:50%',
        'bottom:-8px',
        'transform:translateX(-50%)',
        'width:0',
        'height:0',
        'border-left:9px solid transparent',
        'border-right:9px solid transparent',
        'border-top:9px solid #f4f1ea',
        'filter:drop-shadow(0 1px 0 #c8c2b8)',
      ].join(';');
      el.appendChild(tail);
      const label = document.createElement('span');
      label.dataset.speechLabel = '1';
      label.style.whiteSpace = 'pre-line';
      el.appendChild(label);
      container.appendChild(el);
      this.speechEl = el;
    }

    if (!this.fadeEl) {
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute',
        'inset:0',
        // Day transitions use a solid black cover (no cream brush splash).
        `background:${CUTSCENE_BLACK_FADE_VISIBLE ? FADE_OVERLAY_CSS : 'transparent'}`,
        'opacity:0',
        'pointer-events:none',
        'z-index:2100',
        'transition:none',
      ].join(';');
      container.appendChild(el);
      this.fadeEl = el;
    }

    if (!this.nextDayEl) {
      void ensureOvergrownAveriaFont();
      const el = document.createElement('div');
      el.style.cssText = [
        'position:absolute',
        'left:50%',
        'top:50%',
        'transform:translate(-50%, -50%)',
        // Cream on black so the day card stays readable.
        `color:${NEXT_DAY_TEXT_CSS}`,
        'font:700 42px/1.2 "Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif',
        'letter-spacing:0.01em',
        'pointer-events:none',
        'display:none',
        'z-index:2200',
        'text-align:center',
        'white-space:nowrap',
      ].join(';');
      el.textContent = '';
      container.appendChild(el);
      this.nextDayEl = el;
    }

    return true;
  }

  /**
   * Soft-loop / next-day fade back in: keep the overlay fully black, then fade
   * it. The WebGPU canvas stays presenting — hiding it is what turns a lost
   * device into a white screen.
   */
  private tickCoveredCanvasReveal(deltaTime: number, fadeSec: number): boolean {
    this.setFade(1);
    this.applyTransitionCoverBackground(true);
    this.setRendererPresenting(true);

    if (this.player?.hasPendingScrapDestroys()) {
      this.player.setAllowDeferredDestroys(true);
      if (this.fadeCoverScrapWaitElapsed < FADE_COVER_SCRAP_MAX_WAIT_SEC) {
        this.fadeCoverScrapWaitElapsed += deltaTime;
        this.fadeUncoverArmed = false;
        this.fadeCoverPresentElapsed = 0;
        return false;
      }
      this.player.parkPendingScrapDestroys();
      this.fadeCoverScrapWaitElapsed = 0;
    } else {
      this.fadeCoverScrapWaitElapsed = 0;
    }

    if (!this.fadeUncoverArmed) {
      this.fadeCoverPresentElapsed += deltaTime;
      if (this.fadeCoverPresentElapsed < FADE_COVER_PRESENT_SEC) {
        return false;
      }
      this.fadeUncoverArmed = true;
      this.fadeUncoverElapsed = 0;
      return false;
    }
    this.fadeUncoverElapsed += deltaTime;
    const t = Math.min(1, this.fadeUncoverElapsed / fadeSec);
    this.setFade(1 - t);
    return t >= 1;
  }

  /**
   * Soft-loop day reset: fade to black on the ordinance cam, reset under cover,
   * then fade back to gameplay at the player start.
   */
  private tickDayResetBlackFade(deltaTime: number): void {
    this.player?.setMovementFrozen(true);
    this.player?.forceIdlePose();
    this.dayResetFadeElapsed += deltaTime;
    this.setRendererPresenting(true);

    if (this.dayResetFadePhase === 'toBlack') {
      const t = Math.min(1, this.dayResetFadeElapsed / DAY_RESET_FADE_SEC);
      this.setFade(t);
      if (t < 1) {
        return;
      }
      this.setFade(1);
      this.applyTransitionCoverBackground(true);
      this.performSoftLoopHiddenReset();
      this.stopModelFrontCinematic();
      this.dayResetFadePhase = 'coverPresent';
      this.dayResetFadeElapsed = 0;
      this.fadeUncoverArmed = false;
      this.fadeUncoverElapsed = 0;
      this.fadeCoverPresentElapsed = 0;
      this.fadeCoverScrapWaitElapsed = 0;
      return;
    }

    if (this.dayResetFadePhase === 'coverPresent' || this.dayResetFadePhase === 'fromBlack') {
      if (this.dayResetFadePhase === 'coverPresent') {
        this.dayResetFadePhase = 'fromBlack';
        this.dayResetFadeElapsed = 0;
      }
      if (!this.tickCoveredCanvasReveal(deltaTime, DAY_RESET_FADE_SEC)) {
        return;
      }
      this.setFade(0);
      this.applyTransitionCoverBackground(false);
      this.dayResetFadePhase = null;
      this.zoomOutUsesBlackFade = false;
      this.fadeUncoverArmed = false;
      this.finishNextDayIntoPlayable(true);
      this.beginPendingRoadHighlight();
    }
  }

  private setRendererPresenting(_presenting: boolean): void {
    const canvas = this.getWorld()?.getRenderer()?.domElement;
    if (!canvas) {
      return;
    }
    canvas.style.visibility = 'visible';
    if (!canvas.style.position || canvas.style.position === 'static') {
      canvas.style.position = 'relative';
    }
    canvas.style.zIndex = '1';
  }

  /** Keep the play container black — cream belongs only to the startup splash. */
  private applyTransitionCoverBackground(covered: boolean): void {
    const container = this.getWorld()?.gameContainer;
    if (!container) {
      return;
    }
    if (!CUTSCENE_BLACK_FADE_VISIBLE) {
      container.style.background = 'transparent';
    } else {
      container.style.background = covered ? FADE_OVERLAY_CSS : PLAY_CONTAINER_BG_CSS;
    }
    if (!covered) {
      return;
    }
    container.style.isolation = 'isolate';
    if (this.fadeEl) {
      this.fadeEl.style.zIndex = '2100';
    }
    if (this.nextDayEl && this.nextDayEl.style.display !== 'none') {
      this.nextDayEl.style.zIndex = '2200';
      container.appendChild(this.nextDayEl);
    }
  }

  /** True once the day card has finished typing and a short read hold. */
  private isNextDayLabelDismissible(deltaTime: number): boolean {
    if (!this.nextDayEl || this.nextDayEl.style.display === 'none') {
      return true;
    }
    if (this.nextDayTypingActive) {
      this.nextDayLabelHoldElapsed = -1;
      return false;
    }
    if (this.nextDayLabelHoldElapsed < 0) {
      this.nextDayLabelHoldElapsed = 0;
    }
    this.nextDayLabelHoldElapsed += deltaTime;
    return this.nextDayLabelHoldElapsed >= NEXT_DAY_LABEL_HOLD_SEC;
  }

  /** Resume the GitHub-style post-day fade once the new ordinance is visible. */
  private continueAfterDayReveal(): void {
    const wake =
      this.focusOrdinanceOnWake ? { road: 'mainRoad' as const, clear: () => { this.focusOrdinanceOnWake = false; } }
      : this.focusJaywalkingOnWake ? { road: 'leftSideRoad' as const, clear: () => { this.focusJaywalkingOnWake = false; } }
      : this.focusDoNotStepCarOnWake ? { road: undefined, clear: () => { this.focusDoNotStepCarOnWake = false; } }
      : this.focusDoNotStepTramOnWake ? { road: undefined, clear: () => { this.focusDoNotStepTramOnWake = false; } }
      : this.focusStreetLightsClimbOnWake ? { road: undefined, clear: () => { this.focusStreetLightsClimbOnWake = false; } }
      : this.focusDontDestroyTheStreetLightsOnWake ? { road: undefined, clear: () => { this.focusDontDestroyTheStreetLightsOnWake = false; } }
      : this.focusDontFeedTheCatOnWake ? { road: undefined, clear: () => { this.focusDontFeedTheCatOnWake = false; } }
      : this.focusNoCatsOnStreetsOnWake ? { road: undefined, clear: () => { this.focusNoCatsOnStreetsOnWake = false; } }
      : this.focusNoCratesOnRoadsOnWake ? { road: undefined, clear: () => { this.focusNoCratesOnRoadsOnWake = false; } }
      : this.focusNoRocksOnRoadsOnWake ? { road: undefined, clear: () => { this.focusNoRocksOnRoadsOnWake = false; } }
      : this.focusNoBenchOnRoadsOnWake ? { road: undefined, clear: () => { this.focusNoBenchOnRoadsOnWake = false; } }
      : this.focusNoLogsOnRoadsOnWake ? { road: undefined, clear: () => { this.focusNoLogsOnRoadsOnWake = false; } }
      : this.focusNoWoodPlanksOnRoadsOnWake ? { road: undefined, clear: () => { this.focusNoWoodPlanksOnRoadsOnWake = false; } }
      : this.focusDontRemoveTheConesOnWake ? { road: undefined, clear: () => { this.focusDontRemoveTheConesOnWake = false; } }
      : this.focusNoScrapMetalsOnRoadsOnWake ? { road: undefined, clear: () => { this.focusNoScrapMetalsOnRoadsOnWake = false; } }
      : this.focusDontRemoveThisBushOnWake ? { road: undefined, clear: () => { this.focusDontRemoveThisBushOnWake = false; } }
      : this.focusDontRemoveThisKioskOnWake ? { road: undefined, clear: () => { this.focusDontRemoveThisKioskOnWake = false; } }
      : this.focusDontCutThisPoleOnWake ? { road: undefined, clear: () => { this.focusDontCutThisPoleOnWake = false; } }
      : this.focusDoNotDestroyThisSignOnWake ? { road: undefined, clear: () => { this.focusDoNotDestroyThisSignOnWake = false; } }
      : this.focusDontHitTheFireHydrantOnWake ? { road: undefined, clear: () => { this.focusDontHitTheFireHydrantOnWake = false; } }
      : this.focusHighVoltageOnWake ? { road: undefined, clear: () => { this.focusHighVoltageOnWake = false; } }
      : this.focusNoCuttingOfTreesOnWake ? { road: undefined, clear: () => { this.focusNoCuttingOfTreesOnWake = false; } }
      : this.focusNoClimbingOnTheTreeOnWake ? { road: undefined, clear: () => { this.focusNoClimbingOnTheTreeOnWake = false; } }
      : this.focusDoNotRemoveTheSignsOnWake ? { road: undefined, clear: () => { this.focusDoNotRemoveTheSignsOnWake = false; } }
      : null;

    if (wake) {
      // Ensure cinematic while wake flags are still set, then hold on the board.
      this.ensureWakeOrdinanceCinematic();
      wake.clear();
      if (wake.road) {
        this.pendingRoadHighlight = wake.road;
      }
      this.fadeAfterOrdinanceFocus = false;
      this.ordinanceFocusHoldElapsed = 0;
      this.player?.setCinematicCameraLock(true);
      if (this.viewTargetCam && this.cinematicActive) {
        this.viewTargetCam.setActive(true);
        this.matchCinematicFovToGameplay();
      }
      this.setPhase(FlowPhase.OrdinanceFocus);
      return;
    }

    this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
    this.finishNextDayIntoPlayable();
  }

  /**
   * Make the player prompt feel like a thought arriving, rather than a static
   * HUD element.  The timer is optional because the opening prompt remains up
   * for the existing intro phase, while later-day prompts dismiss themselves.
   */
  private showSpeechBubble(
    text: string,
    readHoldSeconds = 0,
    highlightEnvelope = true,
    deliveryCaption = false,
  ): void {
    const world = this.getWorld();
    if (!this.speechEl && world) {
      this.ensureUi(world);
    }
    if (!this.speechEl) {
      return;
    }
    this.applySpeechBubblePresentation(deliveryCaption);
    const label = this.speechEl.querySelector('[data-speech-label]') as HTMLSpanElement | null;
    if (label) {
      label.textContent = '';
    } else {
      this.speechEl.textContent = '';
    }
    this.speechTypingText = text;
    this.speechTypingElapsed = 0;
    this.speechAutoHideRemaining = 0;
    this.speechPendingReadHoldSec = readHoldSeconds;
    this.speechEl.style.display = 'block';
    this.speechEl.style.left = '50%';
    this.speechEl.style.top = '18%';
    if (highlightEnvelope) {
      this.player?.setMailEnvelopeHighlightPulsing(true);
    }
    if (deliveryCaption) {
      this.deliverySpeechBubblePositionLocked = false;
      this.speechEl.style.minWidth = '';
      this.speechEl.style.minHeight = '';
      this.positionDeliverySpeechBubbleOnce(text);
    } else {
      this.updateSpeechBubblePosition();
    }
    if (text.length === 0) {
      this.armSpeechReadHoldIfPending();
    }
  }

  private applySpeechBubblePresentation(deliveryCaption: boolean): void {
    const el = this.speechEl;
    if (!el) {
      return;
    }
    const tail = el.querySelector('[data-speech-tail]') as HTMLElement | null;
    if (deliveryCaption) {
      // Screen-space thought caption above the player — no tail.
      el.style.transform = 'translate(-50%, -100%)';
      el.style.padding = '20px 28px';
      el.style.borderRadius = '22px';
      el.style.font =
        '700 24px/1.35 "Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif';
      el.style.maxWidth = 'min(480px, 44vw)';
      el.style.boxShadow = '0 12px 32px rgba(74,70,63,0.24)';
      if (tail) {
        tail.style.display = 'none';
      }
      return;
    }
    el.style.transform = 'translate(-50%, -100%)';
    el.style.padding = '12px 16px';
    el.style.borderRadius = '16px';
    el.style.font =
      '700 16px/1.35 "Overgrown Averia","Segoe UI Rounded","Segoe UI",sans-serif';
    el.style.maxWidth = 'min(420px, 80vw)';
    el.style.boxShadow = '0 8px 22px rgba(74,70,63,0.18)';
    if (tail) {
      tail.style.display = 'block';
    }
  }

  /** Start the post-typewriter read hold once the full line is visible. */
  private armSpeechReadHoldIfPending(): void {
    if (this.speechPendingReadHoldSec <= 0 || this.speechAutoHideRemaining > 0) {
      return;
    }
    this.speechAutoHideRemaining = this.speechPendingReadHoldSec;
    this.speechPendingReadHoldSec = 0;
  }

  private handleSpeechBubbleAutoDismiss(): void {
    if (this.phase === FlowPhase.DeliveryFocus) {
      this.finishDeliveryAfterReactionSpeech();
      return;
    }
    if (this.phase === FlowPhase.IntroSpeech) {
      this.playTutorialKeysHint();
      this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
      this.enterPlayableDay(false);
      return;
    }
    this.spawnMailboxTrail();
    this.endAxeRingPulseAfterMorningBubble();
    const showTutorialKeys = this.pendingTutorialKeysAfterSpeech;
    if (showTutorialKeys) {
      this.pendingTutorialKeysAfterSpeech = false;
      this.playTutorialKeysHint();
    }
  }

  private hideSpeechBubble(): void {
    if (this.speechEl) {
      this.speechEl.style.display = 'none';
      this.speechEl.style.minWidth = '';
      this.speechEl.style.minHeight = '';
      this.applySpeechBubblePresentation(false);
    }
    this.deliverySpeechBubblePositionLocked = false;
    this.speechTypingText = '';
    this.speechTypingElapsed = 0;
    this.speechAutoHideRemaining = 0;
    this.speechPendingReadHoldSec = 0;
    this.player?.setMailEnvelopeHighlightPulsing(false);
  }

  /** Advance the character-by-character text used by the day card and prompt. */
  private updateTypingAnimations(deltaTime: number): void {
    const speechEl = this.speechEl;
    if (speechEl && speechEl.style.display !== 'none' && this.speechTypingText) {
      this.speechTypingElapsed += deltaTime;
      const characterCount = Math.min(
        this.speechTypingText.length,
        Math.floor(this.speechTypingElapsed / TYPEWRITER_CHAR_INTERVAL_SEC) + 1,
      );
      const label = speechEl.querySelector('[data-speech-label]') as HTMLSpanElement | null;
      const typedText = this.speechTypingText.slice(0, characterCount);
      if (label) {
        label.textContent = typedText;
      } else {
        speechEl.textContent = typedText;
      }
      if (characterCount >= this.speechTypingText.length) {
        this.speechTypingText = '';
        this.armSpeechReadHoldIfPending();
      }
    }

    if (speechEl && speechEl.style.display !== 'none' && this.speechAutoHideRemaining > 0) {
      this.speechAutoHideRemaining = Math.max(0, this.speechAutoHideRemaining - deltaTime);
      if (this.speechAutoHideRemaining === 0) {
        this.hideSpeechBubble();
        this.handleSpeechBubbleAutoDismiss();
      }
    }

    const nextDayEl = this.nextDayEl;
    if (nextDayEl && nextDayEl.style.display !== 'none' && this.nextDayTypingActive) {
      this.nextDayTypingElapsed += deltaTime;
      const characterCount = Math.min(
        NEXT_DAY_TEXT.length,
        Math.floor(this.nextDayTypingElapsed / TYPEWRITER_CHAR_INTERVAL_SEC) + 1,
      );
      nextDayEl.textContent = NEXT_DAY_TEXT.slice(0, characterCount);
      if (characterCount > this.nextDayTypedCount) {
        this.nextDayTypedCount = characterCount;
        // Typewriter tick per character; spaces stay silent so it reads as typing.
        if (NEXT_DAY_TEXT[characterCount - 1] !== ' ') {
          playSound(this.getWorld(), GameSound.NextDayType, 0.3);
        }
      }
      if (characterCount >= NEXT_DAY_TEXT.length) {
        this.nextDayTypingActive = false;
      }
    }
  }

  private updateSpeechBubblePosition(): void {
    if (!this.speechEl || this.speechEl.style.display === 'none') {
      return;
    }
    if (this.phase === FlowPhase.DeliveryFocus && this.deliverySpeechBubblePositionLocked) {
      return;
    }
    const world = this.getWorld();
    const container = world?.gameContainer;
    if (!container) {
      return;
    }

    if (this.phase === FlowPhase.DeliveryFocus) {
      if (this.deliveryReactionText) {
        this.positionDeliverySpeechBubbleOnce(this.deliveryReactionText);
      }
      return;
    }

    const camera = this.player?.getGameplayCamera() ?? null;
    if (!camera || !this.player) {
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

  /**
   * Place the delivery reaction caption once using the final wrapped size so the
   * typewriter cannot shift it as lines appear.
   */
  private positionDeliverySpeechBubbleOnce(fullText: string): void {
    const el = this.speechEl;
    if (!el || this.deliverySpeechBubblePositionLocked) {
      return;
    }

    const world = this.getWorld();
    const container = world?.gameContainer;
    if (!container || !this.player) {
      return;
    }

    const camera = world?.getActiveCamera() ?? this.player.getGameplayCamera() ?? null;
    if (!camera) {
      el.style.left = '72%';
      el.style.top = '30%';
      this.deliverySpeechBubblePositionLocked = true;
      return;
    }

    const label = el.querySelector('[data-speech-label]') as HTMLSpanElement | null;
    if (label) {
      label.textContent = fullText;
    } else {
      el.textContent = fullText;
    }
    const bubbleWidth = el.offsetWidth || 280;
    const bubbleHeight = el.offsetHeight || 96;
    if (label) {
      label.textContent = '';
    } else {
      el.textContent = '';
    }
    el.style.minWidth = `${bubbleWidth}px`;
    el.style.minHeight = `${bubbleHeight}px`;

    this.resolvePlayerHeadWorld(this.tmpHead);
    this.tmpProjected.copy(this.tmpHead).project(camera);

    const canvas = container.querySelector('canvas');
    const containerRect = container.getBoundingClientRect();
    const canvasRect = canvas?.getBoundingClientRect() ?? containerRect;
    if (canvasRect.width <= 0 || canvasRect.height <= 0) {
      return;
    }

    const anchorX = (this.tmpProjected.x * 0.5 + 0.5) * canvasRect.width
      + (canvasRect.left - containerRect.left);
    const anchorY = (-this.tmpProjected.y * 0.5 + 0.5) * canvasRect.height
      + (canvasRect.top - containerRect.top);
    if (!Number.isFinite(anchorX) || !Number.isFinite(anchorY)) {
      return;
    }

    const marginX = canvasRect.width * 0.2;
    const marginY = canvasRect.height * 0.2;
    const gapAboveAnchor = 12;
    const halfW = bubbleWidth * 0.5;
    const x = THREE.MathUtils.clamp(
      anchorX,
      marginX + halfW,
      canvasRect.width - marginX - halfW,
    );
    const y = THREE.MathUtils.clamp(
      anchorY - gapAboveAnchor,
      marginY + bubbleHeight,
      canvasRect.height - marginY,
    );
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    this.deliverySpeechBubblePositionLocked = true;
  }

  /**
   * Keep the speech bubble fully on-screen. Anchor is the bubble bottom-center
   * (transform: translate(-50%, -100%)).
   */
  private clampSpeechBubbleToScreen(
    anchorX: number,
    anchorY: number,
    canvasWidth: number,
    canvasHeight: number,
    gapAboveAnchor = 12,
  ): void {
    const el = this.speechEl;
    if (!el) {
      return;
    }

    const marginX = canvasWidth * 0.2;
    const marginY = canvasHeight * 0.2;
    let x = anchorX;
    let y = anchorY - gapAboveAnchor;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;

    const width = el.offsetWidth || 280;
    const height = el.offsetHeight || 96;

    const halfW = width * 0.5;
    x = THREE.MathUtils.clamp(x, marginX + halfW, canvasWidth - marginX - halfW);
    y = THREE.MathUtils.clamp(y, marginY + height, canvasHeight - marginY);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
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
      this.fadeEl.style.opacity = String(cutsceneFadeOpacity(opacity));
    }
  }

  private showNextDayLabel(visible: boolean): void {
    if (!this.nextDayEl) {
      return;
    }
    this.nextDayEl.style.display = visible ? 'block' : 'none';
    if (visible) {
      this.nextDayEl.textContent = '';
      this.nextDayTypingElapsed = 0;
      this.nextDayTypingActive = true;
      this.nextDayTypedCount = 0;
      this.nextDayLabelHoldElapsed = -1;
      playSound(this.getWorld(), GameSound.NextDaySting, 0.7);
    } else {
      this.nextDayTypingElapsed = 0;
      this.nextDayTypingActive = false;
      this.nextDayTypedCount = 0;
      this.nextDayLabelHoldElapsed = -1;
    }
  }

  /** Finish a delivery-driven next-day reveal, optionally restoring its prompt. */
  private finishNextDayIntoPlayable(preserveCurrentCamera = false): void {
    this.enterPlayableDay(true, preserveCurrentCamera, { spawnTrail: false });
    if (!this.showPromptAfterNextDayTransition) {
      this.spawnMailboxTrail();
      this.playTutorialKeysHint();
      return;
    }
    this.showPromptAfterNextDayTransition = false;
    this.pendingTutorialKeysAfterSpeech = true;
    this.showSpeechBubble(this.getMorningSpeechText(), SPEECH_READ_HOLD_SEC);
    this.tryPlayAxeRingMorningHint();
  }

  /** Second next-day axe line: pulse the pickup ring while the bubble is up. */
  private tryPlayAxeRingMorningHint(): void {
    if (this.brokenOrdinanceOrder.length !== 2) {
      return;
    }
    const ring = this.getWorld()?.getNodes(AxePickupRingSystem)[0];
    if (!ring || ring.hasEverPickedUp()) {
      return;
    }
    ring.playHint(true);
  }

  private endAxeRingPulseAfterMorningBubble(): void {
    if (this.brokenOrdinanceOrder.length !== 2) {
      return;
    }
    const ring = this.getWorld()?.getNodes(AxePickupRingSystem)[0];
    if (!ring || ring.hasEverPickedUp()) {
      return;
    }
    ring.endHintPulseAfter(5);
  }

  private playTutorialKeysHint(): void {
    const guide = this.getWorld()?.getNodes(TutorialKeysGuide)[0];
    if (!guide) {
      return;
    }
    guide.playHint();
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
   * Soft-loop reset while the screen is fully black (after ordinance fade-out).
   */
  private performSoftLoopHiddenReset(): void {
    this.hideEnvelopeForGpu();
    this.player?.releaseHeldItemsForDayReset();
    this.player?.parkScrapForDayReset();
    this.player?.finishDayResetRest();
    this.restoreDayBaseline();
    this.baselineReinforceRemaining = 10;
    this.restoreAuthoredAxeToBaseline();
    this.player?.prepareScrapForCinematic();
    this.player?.setMovementFrozen(true);
    this.player?.teleportToPlayerStartAndSettle({ armSpawnPhysicsGrace: false });
    this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
    this.player?.retireScrapForDayReset();
  }

  /**
   * Instant spawn teleport while the screen is fully black.
   * Scrap teardown / world restore / ordinance reveal happen later via staging.
   */
  private performHiddenTeleport(): void {
    this.hideEnvelopeForGpu();
    this.stopModelFrontCinematic();
    this.player?.releaseHeldItemsForDayReset();
    this.restoreAuthoredAxeToBaseline();
    this.player?.prepareScrapForCinematic();
    this.player?.setMovementFrozen(true);
    this.player?.teleportToPlayerStartAndSettle({ armSpawnPhysicsGrace: false });
    this.player?.resetGameplayCameraToDefault(DEFAULT_CAMERA_DISTANCE);
  }

  private resetDayTransitionStaging(): void {
    this.dayTransitionTeleportDone = false;
    this.dayTransitionScrapRetired = false;
    this.dayTransitionWorldRestored = false;
    this.dayTransitionWorldRestoreStarted = false;
    this.dayTransitionWorldRestoreCursor = 0;
    this.dayTransitionWorldRestoredAt = 0;
    this.dayTransitionOrdinanceRevealed = false;
    this.dayTransitionOrdinanceRevealedAt = 0;
    this.dayTransitionCamReady = false;
  }

  private shouldPollOrdinances(): boolean {
    return this.phase === FlowPhase.AwaitingDelivery
      || this.phase === FlowPhase.ZoomOutReveal
      || this.phase === FlowPhase.IntroSpeech;
  }

  private isGpuCriticalPhase(): boolean {
    return this.phase === FlowPhase.DeliveryFocus
      || this.phase === FlowPhase.MysteryWinHold
      || this.phase === FlowPhase.FadeToBlack
      || this.phase === FlowPhase.HoldBlack
      || this.phase === FlowPhase.FadeFromBlack
      || this.phase === FlowPhase.OrdinanceFocus
      || (this.phase === FlowPhase.ZoomOutToPlay && this.zoomOutUsesBlackFade);
  }

  /** Keep Rapier off during black-screen day transitions only. */
  private shouldPausePhysicsForTransition(): boolean {
    return this.phase === FlowPhase.FadeToBlack
      || this.phase === FlowPhase.HoldBlack
      || this.phase === FlowPhase.FadeFromBlack
      || (this.phase === FlowPhase.ZoomOutToPlay && this.zoomOutUsesBlackFade);
  }

  /** Full Rapier pause — all black-screen transition phases. */
  private shouldFullyPausePhysicsForTransition(): boolean {
    return this.shouldPausePhysicsForTransition();
  }

  /**
   * Cut GPU-heavy background systems before mailbox cinematic / fade:
   * shophouse translucency, hydrant stream uploads, axe hover, scrap draw.
   * Lamp ground spots stay on — they are world-rooted and must not be toggled.
   */
  private beginGpuSafeTransition(): void {
    if (this.gpuSafeTransitionActive) {
      return;
    }
    this.gpuSafeTransitionActive = true;
    this.setCameraOcclusionPaused(true);
    this.player?.prepareScrapForCinematic();
    this.player?.setGpuThrottled(true);
    this.player?.setAllowDeferredDestroys(false);
    this.mailboxHoverSilhouette.setTarget(null, null);
  }

  private restoreGpuSafeLights(): void {
    // Lamp ground spots are not toggled during transitions.
  }

  private endGpuSafeTransition(): void {
    if (!this.gpuSafeTransitionActive) {
      return;
    }
    this.gpuSafeTransitionActive = false;
    this.player?.setAllowDeferredDestroys(true);
    this.restoreGpuSafeLights();
    this.player?.setGpuThrottled(false);
    this.player?.disposeHiddenMailEnvelope();
    this.clearEnvelope();
    this.setCameraOcclusionPaused(false);
  }

  private setCameraOcclusionPaused(paused: boolean): void {
    this.getWorld()?.getNodes(ShophouseCameraOcclusionSystem).forEach((system) => {
      system.setPaused(paused);
    });
  }

  /**
   * Under full black: teleport → retire scrap → wait for GPU destroy → restore
   * world → reveal boards → snap ordinance cam.
   */
  private tickDayTransitionStaging(): void {
    // Destroy only under full black — CSS fade overlays do not pause WebGPU.
    this.player?.setAllowDeferredDestroys(true);
    const t = this.phaseElapsed;

    if (!this.dayTransitionTeleportDone && t >= DAY_TRANSITION_TELEPORT_SEC) {
      this.performHiddenTeleport();
      this.dayTransitionTeleportDone = true;
    }

    if (
      this.dayTransitionTeleportDone
      && !this.dayTransitionScrapRetired
      && t >= DAY_TRANSITION_SCRAP_RETIRE_SEC
    ) {
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
        // Keep lights off until pending destroys from orphan retire are empty.
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
      && !(this.player?.hasPendingScrapDestroys() ?? false)
    ) {
      this.ensureWakeOrdinanceCinematic();
      this.dayTransitionCamReady = true;
      this.restoreGpuSafeLights();
    }
  }

  private isDayTransitionHoldComplete(): boolean {
    if (!this.dayTransitionCamReady || this.phaseElapsed < NEXT_DAY_LABEL_SEC) {
      return false;
    }
    // Stay black until GPU teardown drains — revealing mid-destroy loses the device.
    return !(this.player?.hasPendingScrapDestroys() ?? false);
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

    for (const node of this.getModelMeshes(world)) {
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

    // Same order as staged day transition: re-parent yanked lamps + rebuild
    // colliders before baseline scrap retirement and pose reinforce.
    this.player?.finishDayResetRest();
    this.beginDayBaselineRestore(world);
    this.applyAllSnapshotPoses();
    this.completeDayBaselineRestore();
  }

  /** Start a black-screen reset without submitting every prop update in one frame. */
  private beginStagedDayBaselineRestore(): void {
    if (this.dayTransitionWorldRestoreStarted) {
      return;
    }
    // Deferred scrap retirement is complete at this stage. Finish the dismantle
    // reset now so persistent effects, including hydrant water streams, are removed.
    this.player?.finishDayResetRest();
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
    this.restoreAuthoredAxeToBaseline();
    this.reapplyOrdinanceVisibility();
    // Ordinance GLBs retain their authored materials after a day reset.  Do not
    // replace or reconfigure their maps here: Studio's editor and Play loader
    // must use the same glTF material and UV data.
    // Defer physics reinforce until playable — hammering teleports under black
    // + brush overlap loses WebGPU.
  }

  /** Keep the authored axe at its session baseline through day resets. */
  private restoreAuthoredAxeToBaseline(): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }
    const axe = world.getNodes(ENGINE.ModelMeshNode).find(
      (node) => AUTHORED_AXE_NAME.test(node.name ?? ''),
    );
    if (!axe) {
      return;
    }
    if (!axe.parent) {
      world.add(axe);
    }
    axe.visible = true;
    axe.traverse((child) => {
      child.visible = true;
    });
    const snap = this.daySnapshots.find((entry) => entry.node === axe);
    if (!snap) {
      return;
    }
    axe.position.copy(snap.localPosition);
    axe.quaternion.copy(snap.localQuaternion);
    axe.scale.copy(snap.scale);
    axe.updateMatrixWorld(true);
    if (!(axe instanceof ENGINE.PrimitiveNode)) {
      return;
    }
    if (snap.physicsOptions) {
      axe.replacePhysicsOptions({
        ...snap.physicsOptions,
        enabled: snap.physicsOptions.enabled !== false,
      });
    } else {
      axe.overridePhysicsOptions({ enabled: false });
    }
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
    if (
      node instanceof ENGINE.PrimitiveNode
      && this.player?.isHoldingTool(node)
    ) {
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
      // Street lamps yanked for scrap lose their Rapier body; re-assert authored
      // static physics after day reset so climbing/standing works again.
      if (
        physicsOptions
        && STREET_LAMP_ROOT_NAME.test(node.name ?? '')
      ) {
        node.replacePhysicsOptions({
          ...physicsOptions,
          enabled: physicsOptions.enabled !== false,
        });
      }
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
    playSound(this.getWorld(), GameSound.EnvelopePaper, 3.2);

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

  private tickMailDeliverSoundDelay(deltaTime: number): void {
    if (this.mailDeliverSoundDelayRemaining < 0) {
      return;
    }
    this.mailDeliverSoundDelayRemaining -= deltaTime;
    if (this.mailDeliverSoundDelayRemaining > 0) {
      return;
    }
    this.mailDeliverSoundDelayRemaining = -1;
    playSound(this.getWorld(), GameSound.MailDelivered, 0.7);
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
      if (this.envelopeMesh.visible) {
        playSound(this.getWorld(), GameSound.MailboxLatch, MAILBOX_LATCH_VOLUME);
        this.mailDeliverSoundDelayRemaining = MAIL_DELIVER_SOUND_DELAY_SEC;
        this.showDeliveryReactionSpeech();
      }
      this.envelopeMesh.visible = false;
    }
  }

  /** Hide the insert mesh without disposing GPU resources mid-fade. */
  private hideEnvelopeForGpu(): void {
    if (this.envelopeMesh) {
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

  /** Ordinance shot distance: 2.5m at scale 1, using world scale (parents + card children). */
  private getOrdinanceFocusDistance(target: ENGINE.SceneNode | null): number {
    const base = ORDINANCE_FOCUS_DISTANCE_AT_SCALE_1;
    if (!target) {
      return base;
    }
    target.updateMatrixWorld(true);
    let multiplier = 0;
    const consider = (node: THREE.Object3D): void => {
      node.getWorldScale(this.tmpDir);
      const axis = Math.max(
        Math.abs(this.tmpDir.x),
        Math.abs(this.tmpDir.y),
        Math.abs(this.tmpDir.z),
      );
      if (Number.isFinite(axis) && axis > multiplier) {
        multiplier = axis;
      }
    };
    consider(target);
    target.traverse((child) => {
      if (child === target) {
        return;
      }
      if (child instanceof ENGINE.ModelMeshNode || child instanceof ENGINE.PrimitiveNode) {
        consider(child);
      }
    });
    if (!Number.isFinite(multiplier) || multiplier <= 0) {
      return base;
    }
    return Math.max(0.1, base * multiplier);
  }

  private startOrdinanceFrontCinematic(
    target: ENGINE.SceneNode | null,
    immediate = false,
    useCapturedStart = false,
  ): void {
    this.startModelFrontCinematic(
      target,
      this.getOrdinanceFocusDistance(target),
      immediate,
      0,
      useCapturedStart,
    );
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
    this.cinematicReturnUsesLookAt = false;
    this.resolveOrdinanceCinematicLookAt(target, this.cinematicLookAt);
    this.matchCinematicFovToGameplay();

    // Pick which board face to stand in front of.
    // Dual-sided cards: choose the face nearer the current gameplay view.
    // One-sided boards (Trees Climbing): the blank back faces the tree/climber, so
    // never pick by player/camera/climb side — frame the street-facing art instead.
    const isOneSidedTreeClimbBoard = NO_CLIMBING_ON_THE_TREE_ANY_NAME.test(target.name ?? '');
    const localForwardZ = 1;
    target.getWorldQuaternion(this.tmpQuat);
    this.tmpForward.set(0, 0, localForwardZ).applyQuaternion(this.tmpQuat);
    this.tmpForward.y = 0;
    if (this.tmpForward.lengthSq() < 1e-6) {
      this.tmpForward.set(0, 0, localForwardZ);
    } else {
      this.tmpForward.normalize();
    }
    if (isOneSidedTreeClimbBoard) {
      // Blank back faces the tree. Prefer the side opposite the climb trigger.
      let lockedFront = false;
      if (this.hasTreeClimbFocusAnchor) {
        this.tmpForward.copy(this.cinematicLookAt).sub(this.treeClimbFocusAnchor);
        this.tmpForward.y = 0;
        if (this.tmpForward.lengthSq() > 1e-6) {
          this.tmpForward.normalize();
          lockedFront = true;
        }
      }
      if (!lockedFront) {
        // Wake / no climb anchor: stand on the street/home side (art faces town).
        const playerStart = world.getNodes(ENGINE.PlayerStart)[0] ?? null;
        if (playerStart) {
          playerStart.updateMatrixWorld(true);
          playerStart.getWorldPosition(this.tmpDir);
          this.tmpDir.sub(this.cinematicLookAt);
          this.tmpDir.y = 0;
          if (this.tmpDir.lengthSq() > 1e-6) {
            this.tmpDir.normalize();
            this.tmpForward.copy(this.tmpDir);
            lockedFront = true;
          }
        }
      }
      if (!lockedFront) {
        this.tryResolveTexturedBoardFront(target, this.tmpForward);
      }
    } else {
      const activeCamera = world.getActiveCamera();
      // Jaywalking is revealed after reset home — frame the street-facing sign side.
      const jaywalkingSideReference = JAYWALKING_ANY_NAME.test(target.name ?? '')
        ? world.getNodes(ENGINE.PlayerStart)[0] ?? null
        : null;
      if (jaywalkingSideReference) {
        jaywalkingSideReference.updateMatrixWorld(true);
        jaywalkingSideReference.getWorldPosition(this.tmpDir);
        this.tmpDir.sub(this.cinematicLookAt);
        this.tmpDir.y = 0;
        if (this.tmpDir.lengthSq() > 1e-6 && this.tmpForward.dot(this.tmpDir) < 0) {
          this.tmpForward.negate();
        }
      } else if (activeCamera) {
        activeCamera.updateMatrixWorld(true);
        activeCamera.getWorldPosition(this.tmpDir);
        this.tmpDir.sub(this.cinematicLookAt);
        this.tmpDir.y = 0;
        if (this.tmpDir.lengthSq() > 1e-6 && this.tmpForward.dot(this.tmpDir) < 0) {
          this.tmpForward.negate();
        }
      }
    }

    // Exact focus distance from look-at. Keep pitch at 0 for ordinances.
    const focusDistance = Math.max(0.1, distance);
    const elev = THREE.MathUtils.degToRad(THREE.MathUtils.clamp(pitchFromFloorDeg, 0, 85));
    const horizontal = focusDistance * Math.cos(elev);
    const height = focusDistance * Math.sin(elev);
    this.cinematicEndPos
      .copy(this.cinematicLookAt)
      .addScaledVector(this.tmpForward, horizontal)
      .addScaledVector(this.upAxis, height);

    // Always pin Euclidean distance so look-at / elev drift cannot leave the shot.
    this.tmpDir.copy(this.cinematicEndPos).sub(this.cinematicLookAt);
    if (this.tmpDir.lengthSq() < 1e-8) {
      this.tmpDir.copy(this.tmpForward);
    }
    this.tmpDir.normalize();
    this.cinematicEndPos
      .copy(this.cinematicLookAt)
      .addScaledVector(this.tmpDir, focusDistance);


    this.tmpMatrix.lookAt(this.cinematicEndPos, this.cinematicLookAt, this.upAxis);
    this.cinematicEndQuat.setFromRotationMatrix(this.tmpMatrix);

    if (immediate) {
      this.cinematicStartPos.copy(this.cinematicEndPos);
      this.cinematicStartQuat.copy(this.cinematicEndQuat);
      this.cinematicBlend = 1;
    } else if (!useCapturedStart) {
      const activeCamera = world.getActiveCamera();
      if (activeCamera) {
        activeCamera.updateMatrixWorld(true);
        activeCamera.getWorldPosition(this.cinematicStartPos);
        activeCamera.getWorldQuaternion(this.cinematicStartQuat);
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
   * Prefer the textured sign face center so focus distance stays true
   * from the board (not the pole/prop AABB midpoint).
   */
  private resolveOrdinanceCinematicLookAt(target: ENGINE.SceneNode, out: THREE.Vector3): void {
    if (this.tryResolveTexturedBoardLookAt(target, out)) {
      return;
    }

    this.tmpBounds.setFromObject(target);
    if (this.tmpBounds.isEmpty()) {
      target.getWorldPosition(out);
      return;
    }

    this.tmpBounds.getCenter(out);
    const name = target.name ?? '';
    const needsUpperBoardAim = JAYWALKING_ANY_NAME.test(name)
      || DO_NOT_STEP_CAR_ANY_NAME.test(name)
      || DO_NOT_STEP_CITY_TRAM_ANY_NAME.test(name)
      || STREET_LIGHTS_CLIMB_ANY_NAME.test(name)
      || STREET_LIGHTS_DESTROY_ANY_NAME.test(name)
      || DONT_FEED_THE_CAT_ANY_NAME.test(name)
      || NO_CATS_ON_STREETS_ANY_NAME.test(name)
      || NO_CRATES_ON_ROADS_ANY_NAME.test(name)
      || NO_ROCKS_ON_ROADS_ANY_NAME.test(name)
      || NO_BENCH_ON_ROADS_ANY_NAME.test(name)
      || NO_LOGS_ON_ROADS_ANY_NAME.test(name)
      || NO_WOOD_PLANKS_ON_ROADS_ANY_NAME.test(name)
      || DONT_REMOVE_THE_CONES_ANY_NAME.test(name)
      || NO_SCRAP_METALS_ON_ROADS_ANY_NAME.test(name)
      || DONT_REMOVE_THIS_BUSH_ANY_NAME.test(name)
      || DONT_REMOVE_THIS_KIOSK_ANY_NAME.test(name)
      || DONT_CUT_THIS_POLE_ANY_NAME.test(name)
      || DO_NOT_DESTROY_THIS_SIGN_ANY_NAME.test(name)
      || DONT_HIT_THE_FIRE_HYDRANT_ANY_NAME.test(name)
      || HIGH_VOLTAGE_ANY_NAME.test(name)
      || NO_CUTTING_OF_TREES_ANY_NAME.test(name)
      || NO_CLIMBING_ON_THE_TREE_ANY_NAME.test(name)
      || DO_NOT_REMOVE_THE_SIGNS_ANY_NAME.test(name)
      || MAINTENANCE_NAME.test(name);
    if (!needsUpperBoardAim) {
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
      if (/board|sign|panel|jaywalk|step|hydrant|tree|cutting|cats?|rocks?|notice|maintenance/i.test(childName)) {
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

  /**
   * Stable look-at: average all textured board mesh centers so dual front/back
   * boards don't pick different focus points between focuses.
   */
  private tryResolveTexturedBoardLookAt(target: ENGINE.SceneNode, out: THREE.Vector3): boolean {
    if (!(target instanceof ENGINE.ModelMeshNode)) {
      return false;
    }
    // Prefer the largest textured mesh so dual front/back boards do not pull the
    // look-at into the board thickness (focus distance then feels inconsistent).
    let bestArea = -1;
    let found = false;
    for (const mesh of target.getAllMeshes()) {
      if (!mesh?.isMesh) {
        continue;
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const hasMap = materials.some((material) => {
        const mapped = material as THREE.Material & { map?: THREE.Texture | null };
        return Boolean(mapped?.map);
      });
      if (!hasMap) {
        continue;
      }
      this.tmpBounds.setFromObject(mesh);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      const size = this.tmpBounds.getSize(this.tmpDir);
      const area = Math.max(size.x * size.y, size.y * size.z, size.z * size.x);
      if (area > bestArea) {
        bestArea = area;
        this.tmpBounds.getCenter(out);
        found = true;
      }
    }
    return found;
  }

  /**
   * World-space front direction for a one-sided textured board (flattened to XZ).
   * Uses the largest textured mesh's local +Z; if that axis is edge-on to the
   * card plane, falls back to the thinnest AABB axis.
   */
  private tryResolveTexturedBoardFront(target: ENGINE.SceneNode, out: THREE.Vector3): boolean {
    if (!(target instanceof ENGINE.ModelMeshNode)) {
      return false;
    }
    let bestMesh: THREE.Mesh | null = null;
    let bestArea = -1;
    for (const mesh of target.getAllMeshes()) {
      if (!mesh?.isMesh) {
        continue;
      }
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      const hasMap = materials.some((material) => {
        const mapped = material as THREE.Material & { map?: THREE.Texture | null };
        return Boolean(mapped?.map);
      });
      if (!hasMap) {
        continue;
      }
      this.tmpBounds.setFromObject(mesh);
      if (this.tmpBounds.isEmpty()) {
        continue;
      }
      const size = this.tmpBounds.getSize(this.tmpDir);
      const area = Math.max(size.x * size.y, size.y * size.z, size.z * size.x);
      if (area > bestArea) {
        bestArea = area;
        bestMesh = mesh;
      }
    }
    if (!bestMesh) {
      return false;
    }

    bestMesh.updateMatrixWorld(true);
    bestMesh.getWorldQuaternion(this.tmpQuat);
    // Card art usually faces local +Z. If that axis is nearly vertical / edge-on,
    // pick the world axis matching the thinnest board dimension instead.
    out.set(0, 0, 1).applyQuaternion(this.tmpQuat);
    out.y = 0;
    if (out.lengthSq() < 0.25) {
      this.tmpBounds.setFromObject(bestMesh);
      const size = this.tmpBounds.getSize(this.tmpDir);
      if (size.x <= size.z && size.x <= size.y) {
        out.set(1, 0, 0).applyQuaternion(this.tmpQuat);
      } else {
        out.set(0, 0, 1).applyQuaternion(this.tmpQuat);
      }
      out.y = 0;
    }
    if (out.lengthSq() < 1e-6) {
      return false;
    }
    out.normalize();
    return true;
  }

  /** Blend the view-target cam from the current shot back onto the player. */
  private beginCinematicReturnToPlayer(distance = DEFAULT_CAMERA_DISTANCE): void {
    this.cinematicReturnDistance = distance;
    if (!this.player || !this.viewTargetCam) {
      this.stopModelFrontCinematic();
      this.player?.resetGameplayCameraToDefault(this.cinematicReturnDistance);
      return;
    }

    // If the wake cinematic was lost (brush / staging), rebuild from the live
    // camera instead of hard-cutting to the spring arm.
    if (!this.cinematicActive) {
      const active = this.getWorld()?.getActiveCamera();
      if (active) {
        active.updateMatrixWorld(true);
        active.getWorldPosition(this.cinematicStartPos);
        active.getWorldQuaternion(this.cinematicStartQuat);
      } else {
        this.player.resetGameplayCameraToDefault(this.cinematicReturnDistance);
        return;
      }
      this.viewTargetCam.position.copy(this.cinematicStartPos);
      this.viewTargetCam.quaternion.copy(this.cinematicStartQuat);
      this.viewTargetCam.updateMatrixWorld(true);
      this.viewTargetCam.setActive(true);
      this.cinematicActive = true;
    }

    // The next-day teleport already plants the pawn while the screen is covered.
    // Re-settling here moves the gameplay camera during the view-target blend,
    // which reads as a small jump when an ordinance focus returns to the player.
    this.player.setMovementFrozen(true);
    this.cinematicReturnInterrupted = false;

    this.viewTargetCam.getWorldPosition(this.cinematicStartPos);
    this.viewTargetCam.getWorldQuaternion(this.cinematicStartQuat);
    // Board look-at from the focus shot (or approximate from current forward).
    this.cinematicStartLookAt.copy(this.cinematicLookAt);
    if (this.cinematicStartLookAt.distanceToSquared(this.cinematicStartPos) < 1e-4) {
      this.tmpForward.set(0, 0, -1).applyQuaternion(this.cinematicStartQuat).normalize();
      this.cinematicStartLookAt.copy(this.cinematicStartPos).addScaledVector(this.tmpForward, MODEL_FOCUS_DISTANCE);
    }

    // Only set the arm target. Resetting the gameplay camera here is a second
    // camera writer while the cinematic camera is blending and causes a snap.
    this.player.setCameraTargetDistance(this.cinematicReturnDistance, true);
    this.player.updateMatrixWorld(true);
    this.syncCinematicReturnEndPose(false);
    // End look-at must match gameplay forward so t=1 equals the spring-arm pose.
    this.tmpForward.set(0, 0, -1).applyQuaternion(this.cinematicEndQuat).normalize();
    this.cinematicEndLookAt.copy(this.cinematicEndPos).addScaledVector(this.tmpForward, 10);
    this.matchCinematicFovToGameplay();

    this.cinematicReturnUsesLookAt = true;
    this.cinematicReturningToPlayer = true;
    this.cinematicBlend = 0;
    this.cinematicActive = true;
    this.updateModelFrontCinematic(0);
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

  /** Seamless handoff: keep the captured blend endpoint, then drop the override. */
  private finishCinematicReturnToPlayer(): void {
    if (this.cinematicReturningToPlayer && this.viewTargetCam && this.player) {
      // Only movement interrupts can change the gameplay endpoint. Re-sampling
      // an otherwise stationary spring arm on the final frame was the source of
      // the maintenance focus jitter and the visible end-of-return snap.
      if (this.cinematicReturnInterrupted) {
        this.syncCinematicReturnEndPose(false);
      }
      this.viewTargetCam.position.copy(this.cinematicEndPos);
      this.viewTargetCam.quaternion.copy(this.cinematicEndQuat);
      this.viewTargetCam.updateMatrixWorld(true);
    }
    this.stopModelFrontCinematic();
    // Arm length only — avoid resetGameplayCamera / follow-height snaps after the blend.
    // The gameplay camera already supplied the exact end pose for this blend.
    // Do not force the spring arm again here: that was the final one-frame snap.
    this.player?.setCameraTargetDistance(this.cinematicReturnDistance, true);
  }

  private updateModelFrontCinematic(deltaTime: number): void {
    if (!this.cinematicActive || !this.viewTargetCam) {
      return;
    }
    // The static target is the smoothest path until input interrupts the shot.
    // Once the player moves, track the live gameplay endpoint so the handoff
    // remains continuous instead of snapping to a stale pose.
    if (this.cinematicReturningToPlayer && this.cinematicReturnInterrupted) {
      this.syncCinematicReturnEndPose(false);
      this.tmpForward.set(0, 0, -1).applyQuaternion(this.cinematicEndQuat).normalize();
      this.cinematicEndLookAt.copy(this.cinematicEndPos).addScaledVector(this.tmpForward, 10);
    }
    const blendSec = this.cinematicReturningToPlayer ? CINEMATIC_RETURN_SEC : CINEMATIC_BLEND_SEC;
    if (blendSec <= 0) {
      this.cinematicBlend = 1;
    } else {
      this.cinematicBlend = Math.min(1, this.cinematicBlend + deltaTime / blendSec);
    }
    const t = this.cinematicBlend;
    // Smootherstep: zero 1st/2nd derivatives at ends — no visible kick at handoff.
    const eased = t * t * t * (t * (t * 6 - 15) + 10);

    if (this.cinematicReturningToPlayer && this.cinematicReturnUsesLookAt) {
      // Position + look-at lerp keeps the board→player pull continuous (no slerp whip).
      this.viewTargetCam.position.lerpVectors(
        this.cinematicStartPos,
        this.cinematicEndPos,
        eased,
      );
      this.tmpDir.lerpVectors(this.cinematicStartLookAt, this.cinematicEndLookAt, eased);
      this.tmpMatrix.lookAt(this.viewTargetCam.position, this.tmpDir, this.upAxis);
      this.viewTargetCam.quaternion.setFromRotationMatrix(this.tmpMatrix);
    } else {
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
    }
    this.viewTargetCam.updateMatrixWorld(true);
  }

  private stopModelFrontCinematic(): void {
    if (this.viewTargetCam?.isActive()) {
      this.viewTargetCam.setActive(false);
    }
    this.cinematicActive = false;
    this.cinematicBlend = 0;
    this.cinematicReturningToPlayer = false;
    this.cinematicReturnUsesLookAt = false;
  }
}
