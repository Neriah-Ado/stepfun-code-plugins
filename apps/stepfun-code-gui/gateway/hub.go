package main

import "sync"

// clientBuffer is the per-tab frame queue depth. Deep enough to absorb a burst
// of fan-out updates, shallow enough that a stalled reader is dropped early.
const clientBuffer = 128

// Hub fans out server-sent event frames to every connected browser tab.
type Hub struct {
	mu      sync.Mutex
	clients map[chan []byte]struct{}
}

func NewHub() *Hub {
	return &Hub{clients: make(map[chan []byte]struct{})}
}

// Subscribe registers a listener. The returned channel carries pre-encoded SSE
// frames and must be released with Unsubscribe.
func (h *Hub) Subscribe() chan []byte {
	channel := make(chan []byte, clientBuffer)

	h.mu.Lock()
	h.clients[channel] = struct{}{}
	h.mu.Unlock()

	return channel
}

// Unsubscribe closes and forgets a listener. Safe to call once per Subscribe.
func (h *Hub) Unsubscribe(channel chan []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	if _, present := h.clients[channel]; present {
		delete(h.clients, channel)
		close(channel)
	}
}

// Broadcast delivers one frame to every listener. A listener whose buffer is
// full is skipped rather than blocked: dropping a progress frame is strictly
// preferable to stalling the reader goroutine.
func (h *Hub) Broadcast(frame []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()

	for channel := range h.clients {
		select {
		case channel <- frame:
		default:
		}
	}
}

// Count reports connected listeners, used by the health endpoint.
func (h *Hub) Count() int {
	h.mu.Lock()
	defer h.mu.Unlock()

	return len(h.clients)
}
