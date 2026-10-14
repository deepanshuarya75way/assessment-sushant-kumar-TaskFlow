import { z } from 'zod';

export const signupSchema = z.object({
  fullName: z.string().trim().min(2, 'Full name must be at least 2 characters').max(80, 'Full name must be 80 characters or fewer'),
  email: z.string().trim().email('Enter a valid email address').max(160, 'Email must be 160 characters or fewer'),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128, 'Password must be 128 characters or fewer')
});

export const loginSchema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z.string().min(1, 'Password is required')
});

export const taskSchema = z.object({
  title: z.string().trim().min(1, 'Title is required').max(120, 'Title must be 120 characters or fewer'),
  description: z.string().trim().max(2000, 'Description must be 2000 characters or fewer').default(''),
  status: z.enum(['Todo', 'In Progress', 'Done'], { errorMap: () => ({ message: 'Status must be Todo, In Progress, or Done' }) }),
  priority: z.enum(['Low', 'Medium', 'High'], { errorMap: () => ({ message: 'Priority must be Low, Medium, or High' }) }),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Due date must use YYYY-MM-DD')
}).superRefine((value, ctx) => {
  const date = new Date(`${value.dueDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value.dueDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['dueDate'], message: 'Due date is invalid' });
  }
});

export function parseTaskInput(body) {
  const result = taskSchema.safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || 'task'}: ${issue.message}`);
    const error = new Error(details.join('; '));
    error.status = 400;
    throw error;
  }
  return result.data;
}

function parseWithSchema(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) {
    const details = result.error.issues.map((issue) => `${issue.path.join('.') || 'request'}: ${issue.message}`);
    const error = new Error(details.join('; '));
    error.status = 400;
    throw error;
  }
  return result.data;
}

export const parseSignupInput = (body) => parseWithSchema(signupSchema, body);
export const parseLoginInput = (body) => parseWithSchema(loginSchema, body);
