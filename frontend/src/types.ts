export interface User { id: number | string; name: string; email: string }
export interface Session { user: User | null; csrfToken: string; demo: { email: string; password: string } | null }
export interface Job {
  id: number | string; title: string; company: string; companyInitials: string; location: string;
  workMode: 'Remote' | 'Hybrid' | 'On-site'; department: string; employmentType: string;
  salaryMin: number; salaryMax: number; currency: string; salaryPeriod: 'hour'; description: string;
  requirements: string[]; skills: string[]; postedAt: string; closesAt: string;
}
export interface Application {
  id: number | string; job: Job; status: 'Submitted' | 'Withdrawn'; motivation: string;
  submittedAt: string; updatedAt: string; events: { status: string; at: string }[];
}
export type View = 'discover' | 'saved' | 'applications';
