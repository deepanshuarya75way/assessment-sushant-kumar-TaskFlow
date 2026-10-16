import {openDB} from 'idb';
const dbpromise=opendB('taskflow',1,{
  upgrade(db){
    db.CreateObjectStore('tasks',{KeyPath: 'id'});
    db.CreateObjectStore('outbox',{KeyPath: 'opTd'});
  },
});

export async function SaveTask(task){
  const db=await dbPromise;
  const t={
    ...task,
    id: task.id ?? crypto.randomUUID(),
    updateAT: Date.now(),
    delete: task.deleted ?? false,
  };

  const tx=db.transaction(['task','outbox'],'readwrite');
  tx.objectstore('tasks').put(t);
  tx.objectstore('outbox').put({opId: crypto.randomUUID(),task: t});
  await tx.done;
  return t;

}

export async function deleyteTask(id){
  const db=await dbPromise;
  const old=awaitdb.get('tasks',id);
  if (old) return saveTask({...old, deleted: true});
}

export async function getTask(){
  const db=await dbPromise;
  const all=await db.getAll('tasks');
  return all.filter((t)=> !t.deleted);
}