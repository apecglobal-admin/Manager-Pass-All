# API Doc - ApecGlobal Manager Pass

Tai lieu nay dung de huong dan du an khac goi API vao ung dung Manager Pass.

## Base URL

Mac dinh khi chay local:

```text
http://127.0.0.1:3000
```

Port lay tu bien moi truong `PORT`, mac dinh la `3000`.

Luu y: server hien dang listen tren `127.0.0.1`, nen du an khac goi duoc khi chay cung may. Neu muon goi tu may khac trong LAN/internet thi can doi cach bind server hoac dat reverse proxy.

## Header Chung

Voi request co body JSON:

```http
Content-Type: application/json
```

API dang xac thuc bang session cookie `session`. Sau khi login thanh cong, server tra ve `Set-Cookie`. Cac request tiep theo phai gui kem cookie nay.

Browser fetch:

```js
await fetch('http://127.0.0.1:3000/api/projects', {
  credentials: 'include'
});
```

Node.js hoac backend khac:

```js
const loginRes = await fetch('http://127.0.0.1:3000/api/auth/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    username: 'admin@example.com',
    password: 'admin-pass'
  })
});

const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];

const projectsRes = await fetch('http://127.0.0.1:3000/api/projects', {
  headers: { cookie }
});
```

## Format Loi

Loi tra ve JSON:

```json
{
  "error": "Permission denied"
}
```

Status hay gap:

| Status | Y nghia |
| --- | --- |
| `400` | Body sai, thieu field, hoac loi xu ly |
| `401` | Chua login hoac session het han |
| `403` | Khong co quyen |
| `404` | Khong tim thay resource |
| `503` | Dich vu auth/invite chua duoc cau hinh |

## Auth

### POST `/api/auth/login`

Dang nhap bang email/password Supabase.

Request:

```json
{
  "username": "admin@example.com",
  "password": "admin-pass"
}
```

Response `200`:

```json
{
  "user": {
    "id": "user-admin",
    "username": "admin@example.com",
    "displayName": "Admin",
    "role": "Admin",
    "status": "Active",
    "permissions": ["users.manage"]
  }
}
```

Response co header `Set-Cookie: session=...`.

### POST `/api/auth/google`

Dang nhap bang Supabase access token da lay tu Google/Supabase Auth.

Request:

```json
{
  "accessToken": "supabase-access-token"
}
```

Response `200`: giong `/api/auth/login`, co `Set-Cookie`.

Neu tai khoan chua duoc admin phe duyet, API tra `403`:

```json
{
  "error": "Tai khoan dang cho admin phe duyet"
}
```

### POST `/api/auth/logout`

Dang xuat va xoa session cookie.

Response `200`:

```json
{
  "ok": true
}
```

### GET `/api/session`

Kiem tra session hien tai.

Response khi da login:

```json
{
  "authenticated": true,
  "user": {
    "id": "user-admin",
    "username": "admin@example.com",
    "role": "Admin"
  }
}
```

Response khi chua login:

```json
{
  "authenticated": false,
  "user": null
}
```

## Users

Yeu cau quyen `users.manage`.

### GET `/api/users`

Lay danh sach user kem project memberships va detailed permissions.

Response `200`:

```json
[
  {
    "id": "user-1",
    "username": "member@example.com",
    "displayName": "Member",
    "role": "Viewer",
    "status": "Active",
    "permissions": [],
    "projectMemberships": ["project-1"],
    "detailedPermissions": []
  }
]
```

### GET `/api/users?basic=1`

Lay danh sach user co ban, khong expand permissions.

### POST `/api/users`

Tao user moi. Neu khong gui `password`, user duoc tao voi status `Invited`.

Request:

```json
{
  "username": "member@example.com",
  "displayName": "Member",
  "role": "Viewer",
  "status": "Active",
  "permissions": [],
  "projectMemberships": ["project-1"],
  "detailedPermissions": [
    {
      "projectId": "project-1",
      "entryTypeId": "type-web",
      "canViewEntry": true,
      "canViewUrl": true,
      "canViewUsername": true,
      "canRevealPassword": false,
      "canViewNotes": true,
      "canCreate": false,
      "canEdit": false,
      "canDelete": false
    }
  ]
}
```

Response `201`:

```json
{
  "id": "user-2",
  "username": "member@example.com",
  "projectMemberships": ["project-1"],
  "detailedPermissions": [],
  "inviteSent": true
}
```

### PATCH `/api/users/:id`

Cap nhat user, memberships, detailed permissions.

Request: gui cac field can cap nhat.

```json
{
  "displayName": "Member Updated",
  "status": "Active",
  "projectMemberships": ["project-1"],
  "detailedPermissions": []
}
```

### DELETE `/api/users/:id`

Xoa user. Khong duoc xoa chinh user dang dang nhap.

Response `200`:

```json
{
  "ok": true,
  "authDeleted": true
}
```

### POST `/api/users/:id/invite`

Gui lai invite email cho user.

Response `200`:

```json
{
  "user": {},
  "inviteSent": true
}
```

## Entry Types

### GET `/api/entry-types`

Lay danh sach loai entry. User co `users.manage` thay ca inactive type.

### POST `/api/entry-types`

Yeu cau quyen `users.manage`.

Request:

```json
{
  "name": "Web",
  "slug": "web",
  "sortOrder": 1,
  "isActive": true
}
```

### PATCH `/api/entry-types/:id`

Yeu cau quyen `users.manage`.

Request:

```json
{
  "name": "Admin",
  "isActive": true
}
```

## Projects

### GET `/api/projects`

Lay danh sach project ma user duoc phep thay. Admin thay tat ca.

Response `200`:

```json
[
  {
    "id": "project-1",
    "name": "Apec Portal",
    "description": "",
    "status": "Active"
  }
]
```

### POST `/api/projects`

Chi `Admin` duoc tao project.

Request:

```json
{
  "name": "Apec Portal",
  "description": "",
  "status": "Active"
}
```

### PATCH `/api/projects/:id`

Chi `Admin`.

Request:

```json
{
  "name": "Apec Portal Updated",
  "status": "Active"
}
```

### DELETE `/api/projects/:id`

Chi `Admin`.

Response `200`:

```json
{
  "ok": true
}
```

### GET `/api/projects/:id/members`

Yeu cau quyen `users.manage`. Lay danh sach member cua project.

### PATCH `/api/projects/:id/members`

Yeu cau quyen `users.manage`. Cap nhat member va detailed permissions cua project.

Request:

```json
{
  "members": [
    {
      "userId": "user-2",
      "detailedPermissions": [
        {
          "entryTypeId": "type-web",
          "canViewEntry": true,
          "canViewUrl": true,
          "canViewUsername": true,
          "canRevealPassword": false,
          "canViewNotes": true,
          "canCreate": true,
          "canEdit": false,
          "canDelete": false
        }
      ]
    }
  ]
}
```

## Entries

### GET `/api/projects/:projectId/entries`

Lay entries trong project. Non-admin chi thay entry va field duoc cap quyen.

Response `200`:

```json
[
  {
    "id": "entry-1",
    "projectId": "project-1",
    "typeId": "type-web",
    "name": "Portal Admin",
    "type": "Web",
    "environment": "Production",
    "url": "https://portal.local",
    "username": "cto",
    "notes": "",
    "tags": ["portal"],
    "status": "Active",
    "permissions": {
      "canViewEntry": true,
      "canRevealPassword": true
    }
  }
]
```

### GET `/api/entries/search?q=keyword`

Tim entry theo keyword. Non-admin chi nhan entry duoc cap quyen.

### GET `/api/entries/:id/edit`

Lay entry day du de edit. Can `canEdit`.

### POST `/api/entries`

Tao entry. Admin duoc tao moi; non-admin can `canCreate` theo project va entry type.

Request:

```json
{
  "projectId": "project-1",
  "typeId": "type-web",
  "name": "Portal Admin",
  "type": "Web",
  "environment": "Production",
  "url": "https://portal.local",
  "username": "cto",
  "password": "portal-secret",
  "notes": "",
  "tags": ["portal"],
  "status": "Active"
}
```

Response `201`: entry vua tao.

### PATCH `/api/entries/:id`

Cap nhat entry. Can `canEdit`.

Request: gui cac field can cap nhat.

```json
{
  "name": "Portal Admin Updated",
  "password": "new-secret",
  "tags": ["portal", "admin"]
}
```

### DELETE `/api/entries/:id`

Xoa entry. Can `canDelete`.

Response `200`:

```json
{
  "ok": true
}
```

### POST `/api/entries/:id/reveal-password`

Lay password that cua entry. Can `canRevealPassword`.

Response `200`:

```json
{
  "password": "portal-secret"
}
```

### POST `/api/entries/:id/copy-password-log`

Ghi log hanh dong copy password. Can `canRevealPassword`.

Response `200`:

```json
{
  "ok": true
}
```

## Export, Backup, Import

### GET `/api/export/json?passwords=1`

Chi `Admin`. Export JSON. Them `passwords=1` de gom password.

### GET `/api/export/csv?passwords=1`

Chi `Admin`. Export CSV. Header:

```text
projectId,name,type,environment,url,username,password,notes,tags,status
```

### POST `/api/backups/save-json`

Chi `Admin`. Tao JSON backup va tra ve noi dung backup.

### POST `/api/import/preview`

Chi `Admin`. Preview rows import.

Request:

```json
{
  "rows": [
    {
      "projectName": "Imported Project",
      "name": "Imported Entry",
      "type": "Web",
      "environment": "Production",
      "url": "https://example.com",
      "username": "admin",
      "password": "secret",
      "notes": "",
      "tags": "tag1|tag2",
      "status": "Active"
    }
  ]
}
```

Response:

```json
{
  "rows": [],
  "count": 0
}
```

### POST `/api/import/commit`

Chi `Admin`. Tao project va entry tu cac rows import.

Request body giong `/api/import/preview`.

## Activity va Settings

### GET `/api/activity`

Lay activity log.

### GET `/api/settings`

Lay settings hien tai.

Response vi du:

```json
{
  "autoLockMinutes": 15
}
```

### PATCH `/api/settings`

Chi `Admin`. Cap nhat settings.

Request:

```json
{
  "autoLockMinutes": 30
}
```

## Vi Du Flow Day Du

```js
const baseUrl = 'http://127.0.0.1:3000';

const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    username: 'admin@example.com',
    password: 'admin-pass'
  })
});

if (!loginRes.ok) {
  throw new Error((await loginRes.json()).error);
}

const cookie = loginRes.headers.get('set-cookie')?.split(';')[0];

const projectRes = await fetch(`${baseUrl}/api/projects`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie
  },
  body: JSON.stringify({
    name: 'Apec Portal',
    description: '',
    status: 'Active'
  })
});

const project = await projectRes.json();

const entryRes = await fetch(`${baseUrl}/api/entries`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    cookie
  },
  body: JSON.stringify({
    projectId: project.id,
    type: 'Web',
    name: 'Portal Admin',
    environment: 'Production',
    url: 'https://portal.local',
    username: 'cto',
    password: 'portal-secret',
    notes: '',
    tags: ['portal'],
    status: 'Active'
  })
});

const entry = await entryRes.json();

const revealRes = await fetch(`${baseUrl}/api/entries/${entry.id}/reveal-password`, {
  method: 'POST',
  headers: { cookie }
});

const { password } = await revealRes.json();
console.log(password);
```
