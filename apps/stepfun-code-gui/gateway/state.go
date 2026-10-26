package main

import (
	"encoding/json"
	"sync"
	"time"
)

// NodeStatus mirrors the lifecycle vocabulary shared with the extension.
type NodeStatus string

const (
	StatusPending   NodeStatus = "pending"
	StatusRunning   NodeStatus = "running"
	StatusDone      NodeStatus = "done"
	StatusFailed    NodeStatus = "failed"
	StatusCancelled NodeStatus = "cancelled"
)

// rootID names the synthetic node representing the main agent.
const rootID = "main"

// Progress is Step Code's fan-out snapshot, forwarded verbatim from the host.
type Progress struct {
	Running       int    `json:"running"`
	Queued        int    `json:"queued"`
	Completed     int    `json:"completed"`
	Total         int    `json:"total"`
	Failures      int    `json:"failures"`
	CacheHits     int    `json:"cacheHits"`
	Cancellations int    `json:"cancellations"`
	TokenSpend    int64  `json:"tokenSpend"`
	Phase         string `json:"phase,omitempty"`
}

// AgentRow is one child agent inside a fan-out. Child agents live in separate
// processes, so the host can only report them in aggregate snapshots.
type AgentRow struct {
	ID      string `json:"id,omitempty"`
	Label   string `json:"label"`
	Summary string `json:"summary,omitempty"`
	Status  string `json:"status,omitempty"`
	Tokens  int64  `json:"tokens,omitempty"`
}

// TokenUsage is provider-reported usage attributed to one tool call.
type TokenUsage struct {
	Input  int64 `json:"input"`
	Output int64 `json:"output"`
}

// Node is one entry in the orchestration tree.
type Node struct {
	ID            string         `json:"id"`
	ParentID      string         `json:"parentId"`
	ToolName      string         `json:"toolName"`
	Label         string         `json:"label"`
	Mode          string         `json:"mode,omitempty"`
	Summary       string         `json:"summary,omitempty"`
	Status        NodeStatus     `json:"status"`
	IsError       bool           `json:"isError,omitempty"`
	Orchestration bool           `json:"orchestration"`
	StartedAt     int64          `json:"startedAt"`
	EndedAt       int64          `json:"endedAt,omitempty"`
	DurationMs    int64          `json:"durationMs,omitempty"`
	Args          map[string]any `json:"args,omitempty"`
	Progress      *Progress      `json:"progress,omitempty"`
	Text          string         `json:"text,omitempty"`
	Agents        []AgentRow     `json:"agents,omitempty"`
	Tokens        *TokenUsage    `json:"tokens,omitempty"`
}

// Session describes the originating Step Code session.
type Session struct {
	ID        string `json:"id"`
	CWD       string `json:"cwd"`
	Model     string `json:"model,omitempty"`
	StartedAt int64  `json:"startedAt"`
}

// RunView is the coarse state of the agent turn loop.
type RunView struct {
	Status  string `json:"status"`
	Phase   string `json:"phase,omitempty"`
	SinceAt int64  `json:"sinceAt,omitempty"`
}

// Stats aggregates the whole tree for the panel header.
type Stats struct {
	Total          int   `json:"total"`
	Orchestrations int   `json:"orchestrations"`
	Running        int   `json:"running"`
	Completed      int   `json:"completed"`
	Failed         int   `json:"failed"`
	TokenSpend     int64 `json:"tokenSpend"`
}

// Snapshot is the full state sent to a tab on connect.
type Snapshot struct {
	Session       Session               `json:"session"`
	Run           RunView               `json:"run"`
	Nodes         []Node                `json:"nodes"`
	Messages      []ConversationMessage `json:"messages"`
	Profiles      []profileView         `json:"profiles"`
	ActiveProfile string                `json:"activeProfileId"`
	ProfileError  string                `json:"profileError,omitempty"`
	Usage         UsageSnapshot         `json:"usage"`
	Stats         Stats                 `json:"stats"`
	ServerAt      int64                 `json:"serverAt"`
}

// Frame is the envelope for every SSE payload.
type Frame struct {
	Type    string `json:"type"`
	Payload any    `json:"payload"`
	TS      int64  `json:"ts"`
	// Monotonic sequence. A gap tells the client it missed a frame and should
	// resynchronise instead of drifting.
	Seq int64 `json:"seq"`
}

// incoming is the union of every message kind the extension can send. A single
// permissive struct keeps the decoder trivial; unknown fields are ignored so a
// host-side field addition never breaks the gateway.
type incoming struct {
	Kind       string         `json:"kind"`
	TS         int64          `json:"ts"`
	SessionID  string         `json:"sessionId"`
	CWD        string         `json:"cwd"`
	Model      string         `json:"model"`
	ToolCallID string         `json:"toolCallId"`
	ToolName   string         `json:"toolName"`
	ParentID   string         `json:"parentId"`
	Mode       string         `json:"mode"`
	Label      string         `json:"label"`
	Summary    string         `json:"summary"`
	Args       map[string]any `json:"args"`
	Progress   *Progress      `json:"progress"`
	Text       string         `json:"text"`
	Agents     []AgentRow     `json:"agents"`
	IsError    bool           `json:"isError"`
	DurationMs int64          `json:"durationMs"`
	Tokens     *TokenUsage    `json:"tokens"`
	Phase      string         `json:"phase"`
	Role       string         `json:"role"`

	// Conversation traffic.
	Messages  []ConversationMessage `json:"messages"`
	Message   *ConversationMessage  `json:"message"`
	RequestID string                `json:"requestId"`
	OK        bool                  `json:"ok"`
	Error     string                `json:"error"`
	LastError string                `json:"lastError"`
	Usage     *UsageSnapshot        `json:"usage"`
}

// TurnMetrics mirrors the per-turn throughput the extension measures.
type TurnMetrics struct {
	Output       int64    `json:"output"`
	TTFTMs       *int64   `json:"ttftMs"`
	GenerationMs *int64   `json:"generationMs"`
	Rate         *float64 `json:"rate"`
}

// UsageSnapshot is context-window consumption plus throughput for the active
// session. A zero Limit means the host did not report one, which the panel
// renders as a bare count rather than a percentage.
type UsageSnapshot struct {
	Used          int64        `json:"used"`
	Limit         int64        `json:"limit,omitempty"`
	SessionOutput int64        `json:"sessionOutput"`
	RecentRate    *float64     `json:"recentRate"`
	Turn          *TurnMetrics `json:"turn"`
	At            int64        `json:"at"`
}

// Store owns the reconstructed tree and pushes deltas onto the hub.
type Store struct {
	mu           sync.Mutex
	hub          *Hub
	conversation *Conversation
	profiles     *profileStore
	usage        UsageSnapshot
	session      Session
	run          RunView
	order        []string
	nodes        map[string]*Node
	/** Monotonic frame counter, see emit. */
	seq int64
}

// Soft ceiling on retained nodes so a very long session cannot grow the
// gateway's memory (and every future snapshot) without bound. Terminal nodes
// are evicted oldest-first; running and pending work is never dropped.
const maxNodes = 1000

func NewStore(hub *Hub, profileDir string) *Store {
	return &Store{
		hub:          hub,
		conversation: NewConversation(),
		profiles:     newProfileStore(profileDir),
		nodes:        make(map[string]*Node),
		run:          RunView{Status: "idle"},
	}
}

// Profiles exposes the credential store to the HTTP layer.
func (s *Store) Profiles() *profileStore {
	return s.profiles
}

// BroadcastProfiles republishes the masked roster to every open tab.
func (s *Store) BroadcastProfiles() {
	views, activeID := s.profiles.Views()
	s.emit("profiles", map[string]any{
		"profiles":  views,
		"activeId":  activeID,
		"lastError": s.profiles.LastError(),
	})
}

// Apply folds one inbound message into the tree and broadcasts the result.
func (s *Store) Apply(message incoming) {
	switch message.Kind {
	case "session":
		s.applySession(message)
	case "agent_start":
		s.setRun("running", message.Phase)
	case "agent_end":
		s.setRun("idle", "")
	case "agent_settled":
		s.setRun("settled", "")
	case "message":
		s.publishRun()
	case "tool_call":
		s.applyToolCall(message)
	case "tool_update":
		s.applyToolUpdate(message)
	case "tool_result":
		s.applyToolResult(message)
	case "conversation_history":
		s.applyConversationHistory(message)
	case "conversation":
		s.applyConversation(message)
	case "action_ack":
		s.applyActionAck(message)
	case "profile_status":
		// The host rejected a credential; surface it against the active profile.
		s.profiles.SetLastError(message.LastError)
		s.BroadcastProfiles()
	case "usage":
		s.applyUsage(message)
	}
}

func (s *Store) applyUsage(message incoming) {
	if message.Usage == nil {
		return
	}

	s.mu.Lock()
	s.usage = *message.Usage
	current := s.usage
	s.mu.Unlock()

	s.emit("usage", current)
}

func (s *Store) applySession(message incoming) {
	s.mu.Lock()
	s.session = Session{
		ID:        message.SessionID,
		CWD:       message.CWD,
		Model:     message.Model,
		StartedAt: orNow(message.TS),
	}
	s.mu.Unlock()

	s.publishSnapshot()
}

func (s *Store) applyConversationHistory(message incoming) {
	s.conversation.Replace(message.Messages)
	s.emit("conversation_history", s.conversation.Snapshot())
}

func (s *Store) applyConversation(message incoming) {
	if message.Message == nil {
		return
	}

	stored, ok := s.conversation.Upsert(*message.Message)
	if !ok {
		return
	}
	s.emit("conversation", stored)
}

// applyActionAck relays the extension's verdict back to the requesting tab.
func (s *Store) applyActionAck(message incoming) {
	s.emit("action_ack", map[string]any{
		"requestId": message.RequestID,
		"ok":        message.OK,
		"error":     message.Error,
	})
}

func (s *Store) applyToolCall(message incoming) {
	if message.ToolCallID == "" {
		return
	}

	node := &Node{
		ID:            message.ToolCallID,
		ParentID:      parentOf(message.ParentID),
		ToolName:      message.ToolName,
		Label:         labelOf(message),
		Mode:          message.Mode,
		Summary:       message.Summary,
		Status:        StatusPending,
		StartedAt:     orNow(message.TS),
		Args:          message.Args,
		Orchestration: isOrchestration(message.ToolName),
	}

	s.mu.Lock()
	s.retainLocked(node)
	s.mu.Unlock()

	s.publishNode(node)
}

// retainLocked registers a node under the size cap. Eviction only walks the
// front of the order list when the cap is actually exceeded, so the common
// path stays O(1); a scan that finds nothing evictable leaves the tree intact.
func (s *Store) retainLocked(node *Node) {
	if _, exists := s.nodes[node.ID]; !exists {
		s.order = append(s.order, node.ID)
		for len(s.order) > maxNodes {
			victim := -1
			for index, id := range s.order {
				candidate := s.nodes[id]
				if candidate == nil {
					victim = index
					break
				}
				if candidate.Status == StatusDone || candidate.Status == StatusFailed ||
					candidate.Status == StatusCancelled {
					victim = index
					break
				}
			}
			if victim < 0 {
				break
			}
			delete(s.nodes, s.order[victim])
			s.order = append(s.order[:victim], s.order[victim+1:]...)
		}
	}
	s.nodes[node.ID] = node
}

func (s *Store) applyToolUpdate(message incoming) {
	if message.ToolCallID == "" {
		return
	}

	s.mu.Lock()
	node := s.nodes[message.ToolCallID]
	if node == nil {
		// The gateway can attach mid-flight, so materialise a placeholder rather
		// than discarding the first progress frames.
		node = &Node{
			ID:            message.ToolCallID,
			ParentID:      rootID,
			ToolName:      message.ToolName,
			Label:         message.ToolName,
			Status:        StatusRunning,
			StartedAt:     orNow(message.TS),
			Orchestration: true,
		}
		s.retainLocked(node)
	}

	if message.Progress != nil {
		node.Progress = message.Progress
		node.Orchestration = true
	}
	if len(message.Agents) > 0 {
		node.Agents = message.Agents
		node.Orchestration = true
	}
	if message.Text != "" {
		node.Text = message.Text
	}
	if node.Status == StatusPending {
		node.Status = StatusRunning
	}
	s.mu.Unlock()

	s.publishNode(node)
}

func (s *Store) applyToolResult(message incoming) {
	if message.ToolCallID == "" {
		return
	}

	s.mu.Lock()
	node := s.nodes[message.ToolCallID]
	if node == nil {
		s.mu.Unlock()
		return
	}

	node.EndedAt = orNow(message.TS)
	if message.DurationMs > 0 {
		node.DurationMs = message.DurationMs
	} else if node.StartedAt > 0 && node.EndedAt >= node.StartedAt {
		node.DurationMs = node.EndedAt - node.StartedAt
	}

	node.IsError = message.IsError
	if message.Tokens != nil {
		node.Tokens = message.Tokens
	}
	if message.IsError {
		node.Status = StatusFailed
	} else {
		node.Status = StatusDone
	}
	s.mu.Unlock()

	s.publishNode(node)
}

func (s *Store) setRun(status, phase string) {
	s.mu.Lock()
	s.run = RunView{Status: status, Phase: phase, SinceAt: nowMs()}
	s.mu.Unlock()

	s.publishRun()
}

// Snapshot returns a consistent copy of the whole tree.
//
// Nodes are VALUE copies taken under the lock. The HTTP layer marshals
// snapshots outside the lock while the stdin reader keeps folding updates
// into the live nodes; handing out pointers would be a data race (and torn
// JSON). A shallow copy is enough: every slice/pointer field of Node is
// replaced wholesale on update, never mutated in place.
func (s *Store) Snapshot() Snapshot {
	s.mu.Lock()
	defer s.mu.Unlock()

	nodes := make([]Node, 0, len(s.order))
	for _, id := range s.order {
		if node := s.nodes[id]; node != nil {
			nodes = append(nodes, *node)
		}
	}

	views, activeID := s.profiles.Views()

	return Snapshot{
		Session:       s.session,
		Run:           s.run,
		Nodes:         nodes,
		Messages:      s.conversation.Snapshot(),
		Profiles:      views,
		ActiveProfile: activeID,
		ProfileError:  s.profiles.LastError(),
		Usage:         s.usage,
		Stats:         s.statsLocked(),
		ServerAt:      nowMs(),
	}
}

func (s *Store) statsLocked() Stats {
	var stats Stats

	for _, node := range s.nodes {
		stats.Total++
		if node.Orchestration {
			stats.Orchestrations++
		}
		switch node.Status {
		case StatusRunning:
			stats.Running++
		case StatusDone:
			stats.Completed++
		case StatusFailed:
			stats.Failed++
		}
		if node.Tokens != nil {
			stats.TokenSpend += node.Tokens.Input + node.Tokens.Output
		}
	}

	return stats
}

func (s *Store) publishNode(node *Node) {
	s.emit("node", node)
}

// SnapshotFrame builds the initial frame for a new subscriber. It carries the
// current sequence so the next delta lines up and does not look like a gap.
func (s *Store) SnapshotFrame() Frame {
	s.mu.Lock()
	seq := s.seq
	s.mu.Unlock()

	return Frame{Type: "snapshot", Payload: s.Snapshot(), TS: nowMs(), Seq: seq}
}

func (s *Store) publishRun() {
	s.mu.Lock()
	run := s.run
	s.mu.Unlock()

	s.emit("run", run)
}

func (s *Store) publishSnapshot() {
	s.emit("snapshot", s.Snapshot())
}

// emit broadcasts one delta with the next sequence number.
//
// Sequence assignment, marshalling, and the broadcast happen under one lock so
// frames reach the hub in seq order even when HTTP handlers and the stdin
// reader emit concurrently — otherwise a client could observe seq 6 before 5
// and misread the inversion as a gap.
//
// The hub drops frames for a slow reader rather than blocking the event loop,
// so the sequence is what lets a client detect the gap and resynchronise.
func (s *Store) emit(kind string, payload any) {
	s.mu.Lock()
	s.seq++
	frame, err := json.Marshal(Frame{Type: kind, Payload: payload, TS: nowMs(), Seq: s.seq})
	s.mu.Unlock()
	if err != nil {
		return
	}
	s.hub.Broadcast(sseFrame(frame))
}

// sseFrame wraps a JSON payload in the text/event-stream wire format.
func sseFrame(payload []byte) []byte {
	out := make([]byte, 0, len(payload)+8)
	out = append(out, "data: "...)
	out = append(out, payload...)
	out = append(out, '\n', '\n')
	return out
}

func isOrchestration(toolName string) bool {
	return toolName == "subagent" || toolName == "workflow"
}

func parentOf(parentID string) string {
	if parentID == "" {
		return rootID
	}
	return parentID
}

func labelOf(message incoming) string {
	if message.Label != "" {
		return message.Label
	}
	if message.ToolName != "" {
		return message.ToolName
	}
	return "tool"
}

func nowMs() int64 {
	return time.Now().UnixMilli()
}

func orNow(ts int64) int64 {
	if ts > 0 {
		return ts
	}
	return nowMs()
}
