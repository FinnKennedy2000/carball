// Every tuning knob lives here. Units are roughly metres and seconds.

export const TICK_HZ = 60
export const DT = 1 / TICK_HZ
export const SNAPSHOT_HZ = 30

// Arena, origin at centre.
export const ARENA_W = 80
export const ARENA_H = 50
export const MIN_X = -ARENA_W / 2
export const MAX_X = ARENA_W / 2
export const MIN_Y = -ARENA_H / 2
export const MAX_Y = ARENA_H / 2

export const GOAL_H = 16 // height of the goal mouth
export const GOAL_DEPTH = 5 // visual only; the goal line is the arena wall

export const CAR_R = 1.9
export const CAR_MASS = 3
export const CAR_ACCEL = 55
export const CAR_REVERSE_ACCEL = 30
export const CAR_MAX_SPEED = 34
export const CAR_BOOST_ACCEL = 65
export const CAR_BOOST_MAX_SPEED = 48
export const CAR_DRAG = 0.7 // forward velocity damping rate
export const GRIP = 11 // lateral velocity damping rate — the main feel knob
export const GRIP_DRIFT = 5 // lateral damping while drifting: the car slides
export const TURN_DRIFT_FACTOR = 1.4 // extra steering authority while drifting
export const TURN_RATE = 3.2 // rad/s at speed
export const TURN_MIN_FACTOR = 0.35 // fraction of TURN_RATE available at a standstill

export const BOOST_MAX = 100
export const BOOST_DRAIN = 34 // per second
export const BOOST_REFILL = 11 // per second

export const BALL_R = 2.6
export const BALL_MASS = 1
export const BALL_DRAG = 0.35
export const BALL_MAX_SPEED = 70

export const RESTITUTION_WALL = 0.75
export const RESTITUTION_BODY = 0.9

export const MATCH_SECONDS = 300
export const KICKOFF_SECONDS = 3
export const GOAL_SECONDS = 2

export const MAX_PLAYERS = 6

// Input bitmask. One byte on the wire.
export const IN_FWD = 1
export const IN_BACK = 2
export const IN_LEFT = 4
export const IN_RIGHT = 8
export const IN_BOOST = 16
export const IN_DRIFT = 32
export const IN_ALL = 63

export const TEAM_BLUE = 0
export const TEAM_ORANGE = 1
