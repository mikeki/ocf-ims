// SPDX-License-Identifier: Apache-2.0

package actionlog

import (
	"context"
	"github.com/mikeki/ocf-ims/store"
	"github.com/mikeki/ocf-ims/store/imsdb"
	"log/slog"
	"time"
)

const (
	workQueueMaxLength = 1024
	insertDeadline     = 10 * time.Second
)

type Logger struct {
	work                chan imsdb.AddActionLogParams
	imsDBQ              *store.DBQ
	actionLogEnabled    bool
	synchronousForTests bool
}

func NewLogger(
	ctx context.Context,
	imsDBQ *store.DBQ,
	actionLogEnabled bool,
	synchronousForTests bool,
) *Logger {
	logger := &Logger{
		work:                make(chan imsdb.AddActionLogParams, workQueueMaxLength),
		imsDBQ:              imsDBQ,
		actionLogEnabled:    actionLogEnabled,
		synchronousForTests: synchronousForTests,
	}
	go logger.startWorker(ctx)
	return logger
}

func (l *Logger) Log(ctx context.Context, record imsdb.AddActionLogParams) {
	if l.actionLogEnabled {
		if l.synchronousForTests {
			l.writeRow(ctx, record)
		} else {
			l.work <- record
		}
	}
}

func (l *Logger) Close() {}

func (l *Logger) startWorker(ctx context.Context) {
	for row := range l.work {
		l.writeRow(ctx, row)
	}
	slog.Info("actionlog.Logger worker finished")
}

func (l *Logger) writeRow(ctx context.Context, row imsdb.AddActionLogParams) {
	// We don't use loggerCtx here, since it gets cancelled soon after SIGINT.
	// We use a different context, so that there's still a chance to write a final
	// row before the server quits.
	ctx, cancel := context.WithTimeout(ctx, insertDeadline)
	defer cancel()
	_, err := l.imsDBQ.AddActionLog(ctx, l.imsDBQ, row)
	if err != nil {
		slog.Error("failed to add action log to db", "error", err)
	}
}
