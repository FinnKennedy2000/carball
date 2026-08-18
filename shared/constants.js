// Every tuning knob lives here. Units are roughly metres and seconds.

export const TICK_HZ = 60
export const DT = 1 / TICK_HZ
// Snapshots go over Supabase Realtime, whose message allowance is project-wide
// (100/s on Free, 500/s on Pro), so the rate is a budget decision as much as a
// smoothness one: every step up here costs one message per second per match.
// The client interpolates between snapshots, so 12 reads smoothly; INTERP_DELAY_MS
// in net.js must stay above one interval (1/12 s) or it interpolates off the end.
export const SNAPSHOT_HZ = 12

// Arena, origin at centre.
export const ARENA_W = 80
export const ARENA_H = 50
export const MIN_X = -ARENA_W / 2
export const MAX_X = ARENA_W / 2
export const MIN_Y = -ARENA_H / 2
export const MAX_Y = ARENA_H / 2

export const GOAL_H = 16 // height of the goal mouth
export const GOAL_DEPTH = 9 // cars can drive in this far behind the goal line

export const CAR_R = 1.9
export const CAR_MASS = 3
export const CAR_ACCEL = 34
export const CAR_REVERSE_ACCEL = 22 // kept at roughly two thirds of forward
export const CAR_MAX_SPEED = 18
export const CAR_BOOST_ACCEL = 65
export const CAR_BOOST_MAX_SPEED = 48
export const CAR_DRAG = 0.7 // forward velocity damping rate
export const GRIP = 14 // lateral velocity damping rate — the main feel knob
export const GRIP_DRIFT = 4 // lateral damping while drifting: the car slides
export const TURN_DRIFT_FACTOR = 1.4 // extra steering authority while drifting
export const TURN_RATE = 4.4 // rad/s at speed
export const TURN_MIN_FACTOR = 0.55 // fraction of TURN_RATE available at a standstill
// Fraction of CAR_MAX_SPEED at which steering reaches full authority. Low, so a
// turn bites as soon as you are moving rather than only at the top end.
export const TURN_FULL_SPEED_FRACTION = 0.3

export const BOOST_MAX = 100
export const BOOST_DRAIN = 34 // per second
export const BOOST_REFILL = 11 // per second

export const BALL_R = 2.6
export const BALL_MASS = 1
export const BALL_DRAG = 0.35
export const BALL_MAX_SPEED = 70

export const RESTITUTION_WALL = 0.75
export const RESTITUTION_BODY = 0.9
// Car on car is arcade rather than elastic: the faster you drive into someone,
// the further they go. This much restitution on top of RESTITUTION_BODY at a
// closing speed of CAR_MAX_SPEED, scaling linearly from nothing at rest. Above 1
// in total, so a ram does inject energy — the speed clamp after collisions is
// what keeps a pile-up bounded.
export const RAM_BONUS = 1

export const MATCH_SECONDS = 300
export const KICKOFF_SECONDS = 3
export const GOAL_SECONDS = 2
export const OVER_SECONDS = 6 // the final score sits on screen this long

export const MAX_PLAYERS = 6
export const MAX_PER_TEAM = MAX_PLAYERS / 2

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
