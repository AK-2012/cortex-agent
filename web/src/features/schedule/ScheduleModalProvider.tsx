import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTRPC } from '@/lib/trpc';
import { useToast } from '@/design';
import { ScheduleModal } from './ScheduleModal';
import {
  defaultScheduleForm,
  buildScheduleAddArgs,
  validateScheduleForm,
  type ScheduleForm,
} from './schedule-modal-vm';

// Global mount + open/close controller for the New-schedule overlay (design 7c). A single modal
// instance lives here; any surface (Overview Schedules "+ New") opens it via useScheduleModal().
// The provider owns the form state + the real `schedules.add` tRPC mutation and invalidates
// `schedules.list` on success. Mirrors the global ⌘K / execution-log-drawer mounts in AppShell.

interface OpenOptions {
  projectId?: string | null;
}

interface ScheduleModalContextValue {
  open: (opts?: OpenOptions) => void;
  close: () => void;
}

const ScheduleModalContext = createContext<ScheduleModalContextValue | null>(null);

export function ScheduleModalProvider({ children }: { children: ReactNode }) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState<ScheduleForm | null>(null);

  const close = useCallback(() => setForm(null), []);
  const open = useCallback((opts?: OpenOptions) => {
    setForm(defaultScheduleForm(opts?.projectId ?? null));
  }, []);

  const addSchedule = useMutation(
    trpc.schedules.add.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries(trpc.schedules.list.queryFilter());
        toast({ title: 'Schedule created', tone: 'done' });
        close();
      },
      onError: (err) => {
        toast({ title: 'Could not create schedule', description: err.message, tone: 'failed' });
      },
    }),
  );

  const onChange = useCallback((patch: Partial<ScheduleForm>) => {
    setForm((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  const onCreate = useCallback(() => {
    setForm((prev) => {
      if (prev && validateScheduleForm(prev).ok) addSchedule.mutate(buildScheduleAddArgs(prev));
      return prev;
    });
  }, [addSchedule]);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <ScheduleModalContext.Provider value={value}>
      {children}
      {form && (
        <ScheduleModal
          form={form}
          onChange={onChange}
          onCancel={close}
          onCreate={onCreate}
          valid={validateScheduleForm(form).ok}
          pending={addSchedule.isPending}
        />
      )}
    </ScheduleModalContext.Provider>
  );
}

export function useScheduleModal(): ScheduleModalContextValue {
  const ctx = useContext(ScheduleModalContext);
  if (!ctx) {
    throw new Error('useScheduleModal must be used within a ScheduleModalProvider');
  }
  return ctx;
}
