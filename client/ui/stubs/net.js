import { mockState } from '../mock.js'
export const enabled = false
export const handlers = {}
let me = 'me', on = false
export const playOffline = async () => { on = true }
export const createRoom = async () => ({ code: 'ABCD' })
export const joinRoom = async () => {}
export const beginMatch = () => {}
export const leave = () => { on = false }
export const myId = () => me
export const isHost = () => true
export const roster = () => []
export const sampleState = (now) => (on ? mockState(now) : null)
export const drainEvents = () => []
