package main

import (
	"testing"
)

// newTestStore wires a Store against an empty hub so Apply/Broadcast paths run
// for real without any HTTP machinery.
func newTestStore(t *testing.T) *Store {
	return NewStore(NewHub(), t.TempDir())
}

func ingest(t *testing.T, store *Store, messages []incoming) {
	t.Helper()
	for _, message := range messages {
		store.Apply(message)
	}
}

func findNode(t *testing.T, store *Store, id string) *Node {
	t.Helper()
	for _, node := range store.Snapshot().Nodes {
		if node.ID == id {
			return &node
		}
	}
	return nil
}

func TestSessionAndToolLifecycle(t *testing.T) {
	store := newTestStore(t)

	ingest(t, store, []incoming{
		{Kind: "session", TS: 1000, SessionID: "s1", CWD: "/demo", Model: "step-3.7-flash"},
		{Kind: "agent_start", TS: 1100},
		{Kind: "tool_call", TS: 1200, ToolCallID: "call1", ToolName: "workflow", Label: "sweep", Mode: "parallel"},
		{Kind: "tool_update", TS: 1300, ToolCallID: "call1", ToolName: "workflow",
			Progress: &Progress{Running: 2, Completed: 1, Total: 6}},
		{Kind: "tool_result", TS: 1900, ToolCallID: "call1", ToolName: "workflow",
			Tokens: &TokenUsage{Input: 100, Output: 40}},
	})

	snapshot := store.Snapshot()

	if snapshot.Session.ID != "s1" || snapshot.Session.Model != "step-3.7-flash" {
		t.Fatalf("session not recorded: %+v", snapshot.Session)
	}
	if snapshot.Run.Status != "running" {
		t.Fatalf("agent_start should set run=running, got %q", snapshot.Run.Status)
	}

	node := findNode(t, store, "call1")
	if node == nil {
		t.Fatal("tool_call did not materialise a node")
	}
	if node.Status != StatusDone {
		t.Fatalf("terminal status should be done, got %q", node.Status)
	}
	if node.DurationMs != 700 {
		t.Fatalf("duration should be result.ts - call.ts = 700, got %d", node.DurationMs)
	}
	if node.Progress == nil || node.Progress.Total != 6 {
		t.Fatalf("progress frame not attached: %+v", node.Progress)
	}
	if node.Tokens == nil || node.Tokens.Input != 100 || node.Tokens.Output != 40 {
		t.Fatalf("token usage not recorded: %+v", node.Tokens)
	}
	if !node.Orchestration {
		t.Fatal("workflow must be flagged as orchestration")
	}

	store.Apply(incoming{Kind: "agent_settled", TS: 2000})
	if snapshot := store.Snapshot(); snapshot.Run.Status != "settled" {
		t.Fatalf("agent_settled should set run=settled, got %q", snapshot.Run.Status)
	}
}

func TestFailedToolResultMarksNodeFailed(t *testing.T) {
	store := newTestStore(t)

	ingest(t, store, []incoming{
		{Kind: "tool_call", TS: 100, ToolCallID: "bad", ToolName: "subagent"},
		{Kind: "tool_result", TS: 200, ToolCallID: "bad", ToolName: "subagent", IsError: true},
	})

	node := findNode(t, store, "bad")
	if node == nil || node.Status != StatusFailed {
		t.Fatalf("errored result should mark node failed, got %+v", node)
	}
	if !node.IsError {
		t.Fatal("isError flag lost")
	}
}

// A fan-out bursts far more nodes than the retention cap; eviction must keep
// the newest state under the ceiling and never drop live work.
func TestNodeEvictionKeepsRunningWork(t *testing.T) {
	store := newTestStore(t)

	for i := 0; i < maxNodes+50; i++ {
		id := string(rune('a'+i%26)) + "-" + itoa(i)
		store.Apply(incoming{Kind: "tool_call", TS: int64(1000 + i), ToolCallID: id, ToolName: "read"})
		store.Apply(incoming{Kind: "tool_result", TS: int64(1100 + i), ToolCallID: id, ToolName: "read"})
	}

	live := "still-running"
	store.Apply(incoming{Kind: "tool_call", TS: 999999, ToolCallID: live, ToolName: "workflow"})

	snapshot := store.Snapshot()
	if len(snapshot.Nodes) > maxNodes {
		t.Fatalf("nodes exceeded cap: %d > %d", len(snapshot.Nodes), maxNodes)
	}
	if findNode(t, store, live) == nil {
		t.Fatal("running node was evicted")
	}
}

// The gateway can attach mid-flight: an update for an unseen call must create
// a running placeholder rather than being dropped.
func TestToolUpdateCreatesPlaceholder(t *testing.T) {
	store := newTestStore(t)

	store.Apply(incoming{Kind: "tool_update", TS: 500, ToolCallID: "orphan", ToolName: "subagent",
		Progress: &Progress{Running: 1, Total: 3}})

	node := findNode(t, store, "orphan")
	if node == nil {
		t.Fatal("update for unknown call was dropped")
	}
	if node.Status != StatusRunning || !node.Orchestration {
		t.Fatalf("placeholder should be running+orchestration, got %q/%v", node.Status, node.Orchestration)
	}
	if node.ParentID != rootID {
		t.Fatalf("placeholder should attach to root, got %q", node.ParentID)
	}
}

// Sequence numbers must increase monotonically across every emitted frame; a
// client treats any gap as a lost frame and resynchronises.
func TestSnapshotFrameSeqIsMonotonic(t *testing.T) {
	store := newTestStore(t)

	first := store.SnapshotFrame()
	store.Apply(incoming{Kind: "tool_call", TS: 10, ToolCallID: "n1", ToolName: "read"})
	store.Apply(incoming{Kind: "agent_start", TS: 20})
	second := store.SnapshotFrame()

	if second.Seq <= first.Seq {
		t.Fatalf("seq must grow: first=%d second=%d", first.Seq, second.Seq)
	}
	snapshot, ok := second.Payload.(Snapshot)
	if !ok {
		t.Fatalf("snapshot frame payload type mismatch: %T", second.Payload)
	}
	if snapshot.Stats.Total != 1 {
		t.Fatalf("snapshot should carry one node, got %d", snapshot.Stats.Total)
	}
}

func TestStatsAggregation(t *testing.T) {
	store := newTestStore(t)

	ingest(t, store, []incoming{
		{Kind: "tool_call", TS: 1, ToolCallID: "a", ToolName: "workflow"},
		{Kind: "tool_result", TS: 2, ToolCallID: "a", ToolName: "workflow", Tokens: &TokenUsage{Input: 10, Output: 5}},
		{Kind: "tool_call", TS: 3, ToolCallID: "b", ToolName: "read"},
		{Kind: "tool_result", TS: 4, ToolCallID: "b", ToolName: "read", IsError: true},
		{Kind: "tool_call", TS: 5, ToolCallID: "c", ToolName: "grep"},
		// An update flips the pending call into running, which is what the
		// Running counter actually tracks.
		{Kind: "tool_update", TS: 6, ToolCallID: "c", ToolName: "grep"},
	})

	stats := store.Snapshot().Stats
	if stats.Total != 3 || stats.Orchestrations != 1 || stats.Completed != 1 || stats.Failed != 1 || stats.Running != 1 {
		t.Fatalf("unexpected stats: %+v", stats)
	}
	if stats.TokenSpend != 15 {
		t.Fatalf("token spend should sum input+output=15, got %d", stats.TokenSpend)
	}
}

func itoa(value int) string {
	if value == 0 {
		return "0"
	}
	var digits []byte
	for value > 0 {
		digits = append([]byte{byte('0' + value%10)}, digits...)
		value /= 10
	}
	return string(digits)
}
