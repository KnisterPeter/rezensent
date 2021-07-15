import { promisify } from "util";
import { enqueue, Task } from "./queue";

const wait = promisify(setTimeout);

test("enqueue should run a task if queue is empty and a task is enqueued", async () => {
  let wasExecuted = false;

  const context = {
    log: {
      info: jest.fn(),
    },
  };
  const task: Task = {
    name: "name",
    number: 0,
    async run() {
      wasExecuted = true;
    },
  };

  enqueue(context as any, "reason", task);

  await wait(10);

  expect(wasExecuted).toBeTruthy();
});

test("enqueue should run tasks in order of scheduling", async () => {
  const executionOrder: number[] = [];

  const context = {
    log: {
      info: jest.fn(),
    },
  };

  const task1: Task = {
    name: "name",
    number: 10,
    async run() {
      executionOrder.push(10);
    },
  };
  const task2: Task = {
    name: "name",
    number: 5,
    async run() {
      executionOrder.push(5);
    },
  };

  enqueue(context as any, "reason", task1);
  enqueue(context as any, "reason", task2);

  await wait(10);

  expect(executionOrder).toEqual([10, 5]);
});

test("enqueue should remove and requeue a task if it is re-enqueued", async () => {
  const executionOrder: number[] = [];

  const context = {
    log: {
      info: jest.fn(),
    },
  };

  const task1: Task = {
    name: "name",
    number: 10,
    async run() {
      executionOrder.push(10);
    },
  };
  const task2: Task = {
    name: "name",
    number: 5,
    async run() {
      executionOrder.push(5.1);
    },
  };
  const task3: Task = {
    name: "name",
    number: 5,
    async run() {
      executionOrder.push(5.2);
    },
  };

  enqueue(context as any, "reason", task1);
  enqueue(context as any, "reason", task2);
  enqueue(context as any, "reason", task3);

  await wait(10);

  expect(executionOrder).toEqual([10, 5.2]);
});

test("enqueue should cancel and requeue a task if it is re-enqueued and already running", async () => {
  const executionOrder: number[] = [];

  const context = {
    log: {
      info: jest.fn(),
    },
  };

  const task1: Task = {
    name: "name",
    number: 10,
    async run(token) {
      executionOrder.push(10.1);

      await wait(5);

      token.abortIfCanceled();
      executionOrder.push(10.2);
    },
  };
  const task2: Task = {
    name: "name",
    number: 10,
    async run() {
      executionOrder.push(10.3);
    },
  };

  enqueue(context as any, "reason", task1);
  enqueue(context as any, "reason", task2);

  await wait(15);

  expect(executionOrder).toEqual([10.1, 10.3]);
});
