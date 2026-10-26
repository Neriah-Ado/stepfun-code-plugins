package main

import "sync"

// conversationLimit bounds the mirrored chat history so a long session cannot
// grow the panel's memory without limit.
const conversationLimit = 400

// ConversationMessage is one chat turn mirrored from the host session.
type ConversationMessage struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Text      string `json:"text"`
	At        int64  `json:"at"`
	Streaming bool   `json:"streaming,omitempty"`
}

// Conversation keeps the ordered chat log plus an id index so streaming updates
// can address a message without scanning.
type Conversation struct {
	mu       sync.Mutex
	order    []string
	messages map[string]*ConversationMessage
}

func NewConversation() *Conversation {
	return &Conversation{messages: make(map[string]*ConversationMessage)}
}

// Replace swaps the whole log. Used when the extension replays session history.
func (c *Conversation) Replace(list []ConversationMessage) {
	c.mu.Lock()
	defer c.mu.Unlock()

	c.order = nil
	c.messages = make(map[string]*ConversationMessage, len(list))

	for index := range list {
		message := list[index]
		if message.ID == "" {
			continue
		}
		// Defensive copy: the slice belongs to the caller.
		stored := message
		c.messages[stored.ID] = &stored
		c.order = append(c.order, stored.ID)
	}

	c.trimLocked()
}

// Upsert inserts or updates one message and reports the stored copy.
func (c *Conversation) Upsert(message ConversationMessage) (ConversationMessage, bool) {
	if message.ID == "" {
		return message, false
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if existing, present := c.messages[message.ID]; present {
		*existing = message
		return *existing, true
	}

	stored := message
	c.messages[stored.ID] = &stored
	c.order = append(c.order, stored.ID)
	c.trimLocked()

	return stored, true
}

// Snapshot returns the log in insertion order.
func (c *Conversation) Snapshot() []ConversationMessage {
	c.mu.Lock()
	defer c.mu.Unlock()

	out := make([]ConversationMessage, 0, len(c.order))
	for _, id := range c.order {
		if message := c.messages[id]; message != nil {
			out = append(out, *message)
		}
	}
	return out
}

func (c *Conversation) trimLocked() {
	if len(c.order) <= conversationLimit {
		return
	}

	cut := len(c.order) - conversationLimit
	for _, id := range c.order[:cut] {
		delete(c.messages, id)
	}
	c.order = append([]string(nil), c.order[cut:]...)
}
