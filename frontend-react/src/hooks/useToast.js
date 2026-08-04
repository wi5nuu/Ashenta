import { create } from 'zustand'

let _id = 0

export const useToastStore = create((set) => ({
  toasts: [],
  add: (toast) => {
    const id = ++_id
    set(s => ({ toasts: [...s.toasts, { id, ...toast }] }))
    // auto-dismiss
    setTimeout(() => {
      set(s => ({ toasts: s.toasts.filter(t => t.id !== id) }))
    }, toast.duration || 3500)
    return id
  },
  remove: (id) => set(s => ({ toasts: s.toasts.filter(t => t.id !== id) })),
}))

export function useToast() {
  const add = useToastStore(s => s.add)
  return {
    success: (msg) => add({ type: 'success', msg }),
    error:   (msg) => add({ type: 'error',   msg, duration: 5000 }),
    info:    (msg) => add({ type: 'info',     msg }),
    warn:    (msg) => add({ type: 'warn',     msg }),
  }
}
