import { z } from 'zod';
export declare const projectsListInput: z.ZodObject<{}, z.core.$strip>;
export declare const sessionsListInput: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    resumable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const threadsListInput: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodArray<z.ZodString>>;
}, z.core.$strip>;
export declare const tasksListInput: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    status: z.ZodOptional<z.ZodEnum<{
        open: "open";
        done: "done";
    }>>;
    actionable: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const schedulesListInput: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodString>;
    paused: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export declare const executionsListInput: z.ZodObject<{
    status: z.ZodOptional<z.ZodArray<z.ZodString>>;
    limit: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const costSummaryInput: z.ZodObject<{
    projectId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
}, z.core.$strip>;
export declare const threadsCancelInput: z.ZodObject<{
    threadId: z.ZodString;
}, z.core.$strip>;
export declare const executionsCancelInput: z.ZodObject<{
    executionId: z.ZodString;
}, z.core.$strip>;
export declare const scheduleActionInput: z.ZodObject<{
    scheduleId: z.ZodString;
}, z.core.$strip>;
export declare const taskActionInput: z.ZodObject<{
    projectId: z.ZodString;
    taskId: z.ZodString;
}, z.core.$strip>;
export declare const taskCompleteInput: z.ZodObject<{
    projectId: z.ZodString;
    taskId: z.ZodString;
    note: z.ZodOptional<z.ZodString>;
}, z.core.$strip>;
export declare const taskBlockInput: z.ZodObject<{
    projectId: z.ZodString;
    taskId: z.ZodString;
    reason: z.ZodString;
}, z.core.$strip>;
export declare const queryInputSchemas: {
    'projects.list': z.ZodObject<{}, z.core.$strip>;
    'sessions.list': z.ZodObject<{
        projectId: z.ZodOptional<z.ZodString>;
        resumable: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    'threads.list': z.ZodObject<{
        projectId: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodArray<z.ZodString>>;
    }, z.core.$strip>;
    'tasks.list': z.ZodObject<{
        projectId: z.ZodOptional<z.ZodString>;
        status: z.ZodOptional<z.ZodEnum<{
            open: "open";
            done: "done";
        }>>;
        actionable: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    'schedules.list': z.ZodObject<{
        projectId: z.ZodOptional<z.ZodString>;
        paused: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    'executions.list': z.ZodObject<{
        status: z.ZodOptional<z.ZodArray<z.ZodString>>;
        limit: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>;
    'cost.summary': z.ZodObject<{
        projectId: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    }, z.core.$strip>;
};
export declare const mutateInputSchemas: {
    'threads.cancel': z.ZodObject<{
        threadId: z.ZodString;
    }, z.core.$strip>;
    'executions.cancel': z.ZodObject<{
        executionId: z.ZodString;
    }, z.core.$strip>;
    'schedules.pause': z.ZodObject<{
        scheduleId: z.ZodString;
    }, z.core.$strip>;
    'schedules.resume': z.ZodObject<{
        scheduleId: z.ZodString;
    }, z.core.$strip>;
    'schedules.remove': z.ZodObject<{
        scheduleId: z.ZodString;
    }, z.core.$strip>;
    'tasks.claim': z.ZodObject<{
        projectId: z.ZodString;
        taskId: z.ZodString;
    }, z.core.$strip>;
    'tasks.unclaim': z.ZodObject<{
        projectId: z.ZodString;
        taskId: z.ZodString;
    }, z.core.$strip>;
    'tasks.complete': z.ZodObject<{
        projectId: z.ZodString;
        taskId: z.ZodString;
        note: z.ZodOptional<z.ZodString>;
    }, z.core.$strip>;
    'tasks.block': z.ZodObject<{
        projectId: z.ZodString;
        taskId: z.ZodString;
        reason: z.ZodString;
    }, z.core.$strip>;
    'tasks.unblock': z.ZodObject<{
        projectId: z.ZodString;
        taskId: z.ZodString;
    }, z.core.$strip>;
};
