// Tuning for the 3D car-football sim. Units: metres, seconds, Y up, car forward = +Z.
export const TICK_HZ = 60
export const DT = 1 / TICK_HZ
export const SNAPSHOT_HZ = 12
export const MATCH_SECONDS = 300
export const MAX_PLAYERS = 6
export const TEAM_BLUE = 0
export const TEAM_ORANGE = 1

export const COUNTDOWN_SECONDS = 3
export const GOAL_SECONDS = 4
export const RESPAWN_SECONDS = 3

// world
export const GRAVITY = 14
export const BALL_R = 1.85
export const BALL_MASS = 1
export const CAR_MASS = 6
export const BALL_MAX_SPEED = 60
export const BALL_RESTITUTION = 0.6
export const BALL_DRAG = 0.03 // fraction of speed lost per second
export const BALL_HIT_EXTRA = 0.35 // extra push as a fraction of relative speed
export const BALL_HIT_EXTRA_MAX = 14

// driving
export const CAR_DRIVE_ACCEL = 20
export const CAR_DRIVE_MAX = 24 // throttle alone stops pushing past this
export const CAR_BRAKE = 38
export const CAR_COAST = 6
export const CAR_BOOST_ACCEL = 26
export const CAR_BOOST_MAX_SPEED = 34
export const CAR_SUPERSONIC = 30
export const CAR_SUPERSONIC_OFF = 29
export const CAR_TURN_LOW = 2.5 // rad/s at standstill
export const CAR_TURN_HIGH = 0.85 // rad/s at boost speed
export const CAR_GRIP = 14 // lateral velocity killed per second (ratio)
export const CAR_SLIDE_GRIP = 1.6 // with handbrake
export const CAR_STICK = 18 // m/s^2 pressing the car onto whatever surface it drives on
export const WHEEL_CONTACT = 0.3
export const WHEEL_STICKY = 0.9 // once grounded, curves (fillets) must not shake the car loose

// jump / dodge
export const JUMP_V = 8
export const JUMP_HOLD_ACCEL = 12
export const JUMP_HOLD_TIME = 0.2
export const FLIP_WINDOW = 1.25
export const DODGE_IMPULSE = 12
export const DODGE_SPIN = 5.5
export const DODGE_TIME = 0.6
export const DODGE_DEADZONE = 0.4

// air control
export const AIR_PITCH = 5.5
export const AIR_YAW = 4.5
export const AIR_ROLL = 6
export const AIR_RESPONSE = 9
export const AIR_DAMP = 2.5
export const AIR_ASSIST = 0 // reserved

// boost
export const BOOST_MAX = 100
export const BOOST_START = 33
export const BOOST_DRAIN = 33.3
export const PAD_BIG = 100
export const PAD_SMALL = 12
export const PAD_BIG_RESPAWN = 10
export const PAD_SMALL_RESPAWN = 4
export const PAD_BIG_R = 3.2
export const PAD_SMALL_R = 2.3

// bumps / demos
export const BUMP_RESTITUTION = 0.35

// points
export const POINTS = { goal: 100, assist: 50, save: 50, shot: 20, demo: 25 }
