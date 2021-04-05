import { Context } from "probot";

export interface CancellationToken {
  canceled: boolean;
  abortIfCanceled(): void;
}

export interface Task {
  readonly name: string;
  readonly number: number;

  run(token: CancellationToken): Promise<void>;
}

let queue: readonly [reason: string, task: Task][] = [];
let current:
  | {
      task: Task;
      token: CancellationToken;
      promise: Promise<void>;
    }
  | undefined;

export function enqueue(context: Context, reason: string, task: Task): void {
  if (current) {
    const isSame = (t1: Task, t2: Task) =>
      t1.name === t2.name && t1.number === t2.number;

    const filtered = queue.filter(([, item]) => !isSame(item, task));
    if (filtered.length < queue.length) {
      context.log.info(
        taskMessage(task, "already in queue -> requeue", "Queue task")
      );
      queue = filtered;
    }
    if (isSame(current.task, task)) {
      context.log.info(
        taskMessage(task, "cancel current task -> requeue", "Queue task")
      );
      current.token.canceled = true;
    }

    queue = [...queue, [reason, task]];
    context.log.info(taskMessage(task, reason, "Queue task"));
  } else {
    const runTask = async (
      reason: string,
      task: Task,
      token: CancellationToken
    ) => {
      context.log.info(taskMessage(task, reason, "Start task"));

      try {
        await task.run(token);
      } catch (err) {
        if (err === CancellationTokenImpl.signal) {
          context.log.info(taskMessage(task, reason, "Canceled task"));
        } else {
          context.log.error(err);
        }
      }

      context.log.info(taskMessage(task, reason, "End task"));
    };

    const next = () => {
      const [item, ...rest] = queue;
      queue = rest;

      if (item) {
        const token = new CancellationTokenImpl();
        const [reason, task] = item;

        current = {
          task,
          token,
          promise: runTask(reason, task, token).then(next),
        };
      } else {
        current = undefined;
      }
    };

    const token = new CancellationTokenImpl();
    current = {
      task,
      token,
      promise: runTask(reason, task, token).then(next),
    };
  }
}

function taskMessage(task: Task, reason: string, message: string): string {
  return `${message.padEnd(14)}| [PR-${task.number}] ${task.name} | ${reason}`;
}

class CancellationTokenImpl implements CancellationToken {
  public static signal = new Error();

  public canceled = false;

  public abortIfCanceled() {
    if (this.canceled) {
      throw CancellationTokenImpl.signal;
    }
  }
}
