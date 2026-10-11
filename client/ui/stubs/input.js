let b = { throttleUp: 'KeyW', throttleDown: 'KeyS', jump: 'Space', boost: 'ShiftLeft' }
export const startInput = () => {}
export const setInputEnabled = () => {}
export const currentInput = () => ({})
export const getBindings = () => ({ ...b })
export const setBinding = (a, c) => { b[a] = c }
