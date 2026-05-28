import db from "@/lib/db";
import type { Project } from "@/types";
import { isAdminUser } from "@/lib/authorization";

export type ProjectWithMembers = Project & {
  member_user_ids: number[];
};

export const getProjectsForUser = (userId: number): ProjectWithMembers[] => {
  const projects = isAdminUser(userId)
    ? (db
        .prepare(`
          SELECT p.*
          FROM projects p
          ORDER BY p.created_at ASC, p.id ASC
        `)
        .all() as Project[])
    : (db
        .prepare(`
          SELECT p.*
          FROM projects p
          INNER JOIN project_members pm ON pm.project_id = p.id
          WHERE pm.user_id = ?
          ORDER BY p.created_at ASC, p.id ASC
        `)
        .all(userId) as Project[]);

  if (projects.length === 0) {
    return [];
  }

  const projectIds = projects.map((project) => project.id);
  const placeholders = projectIds.map(() => "?").join(", ");
  const projectMembers = db
    .prepare(`
      SELECT project_id, user_id
      FROM project_members
      WHERE project_id IN (${placeholders})
      ORDER BY project_id ASC, user_id ASC
    `)
    .all(...projectIds) as Array<{ project_id: number; user_id: number }>;

  const memberIdsByProject = new Map<number, number[]>();
  for (const member of projectMembers) {
    const members = memberIdsByProject.get(member.project_id) ?? [];
    members.push(member.user_id);
    memberIdsByProject.set(member.project_id, members);
  }

  return projects.map((project) => ({
    ...project,
    member_user_ids: memberIdsByProject.get(project.id) ?? [],
  }));
};
