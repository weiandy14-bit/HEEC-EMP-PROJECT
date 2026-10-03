import type { GanttProject, GanttTask } from './types';
export const ROW_HEIGHT = 30;
export interface LayoutRow { task: GanttTask; depth: number; hasChildren: boolean }
export interface ProjectLayout { project: GanttProject; rows: LayoutRow[]; indices: Map<string, number>; top: number; height: number }
/** Iterative traversal avoids stack overflow for deep imported WBS. */
export function layoutProjects(projects: GanttProject[], collapsed: Set<string>): ProjectLayout[] {
  let top = ROW_HEIGHT; // timeline header
  return projects.map((project) => {
    const children = new Map<string | null, GanttTask[]>();
    const ids = new Set(project.tasks.map((t) => t.id));
    for (const task of project.tasks) {
      const parent = task.parent_id && ids.has(task.parent_id) ? task.parent_id : null;
      const bucket = children.get(parent) ?? []; bucket.push(task); children.set(parent,bucket);
    }
    const rows: LayoutRow[] = [], visited = new Set<string>();
    const stack = (children.get(null) ?? []).slice().reverse().map((task) => ({task,depth:0}));
    if (!collapsed.has(`project:${project.id}`)) while (stack.length) {
      const row = stack.pop()!;
      if (visited.has(row.task.id)) continue;
      visited.add(row.task.id);
      const descendants = children.get(row.task.id) ?? [];
      rows.push({...row,hasChildren:descendants.length>0});
      if (!collapsed.has(row.task.id)) for (let i=descendants.length-1;i>=0;i--) stack.push({task:descendants[i],depth:row.depth+1});
    }
    const indices = new Map(rows.map((r,i)=>[r.task.id,i]));
    const height = (rows.length+1)*ROW_HEIGHT;
    const layout = {project,rows,indices,top,height}; top += height; return layout;
  });
}
/** Return only projects/rows intersecting the viewport plus overscan, keeping exact spacers. */
export function virtualWindow(layouts: ProjectLayout[], scrollTop: number, viewportHeight: number, overscan = 8) {
  const low = Math.max(ROW_HEIGHT,scrollTop-overscan*ROW_HEIGHT);
  const high = scrollTop+viewportHeight+overscan*ROW_HEIGHT;
  const visible = layouts.filter((l)=>l.top+l.height>low && l.top<high).map((layout)=>({
    layout,
    start:Math.max(0,Math.floor((low-layout.top-ROW_HEIGHT)/ROW_HEIGHT)),
    end:Math.min(layout.rows.length,Math.max(0,Math.ceil((high-layout.top-ROW_HEIGHT)/ROW_HEIGHT))),
  }));
  const total = layouts.length ? layouts[layouts.length-1].top+layouts[layouts.length-1].height : ROW_HEIGHT;
  const before = visible.length ? visible[0].layout.top-ROW_HEIGHT : Math.max(0,total-ROW_HEIGHT);
  const after = visible.length ? total-visible[visible.length-1].layout.top-visible[visible.length-1].layout.height : 0;
  return {visible,before,after,total};
}
