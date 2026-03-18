// 用户、Profile、权限、登录历史等工具
import { z } from "zod";
import {
  sfQueryAll,
  sfRestGet,
  sfToolingQuery,
  limitValue,
  escapeSoqlLiteral,
  CHATTER_ME_PATH,
  DEFAULT_LIMIT_MAX
} from "../core/connection.js";
import { textContent } from "../core/utils.js";

// Profile 权限字段与 ObjectPermissions 字段的映射
const PROFILE_TO_PS_KEY_MAP = {
  PermissionsCreate: "canCreate",
  PermissionsRead: "canRead",
  PermissionsEdit: "canEdit",
  PermissionsDelete: "canDelete",
  PermissionsViewAllRecords: "viewAllRecords",
  PermissionsModifyAllRecords: "modifyAllRecords"
};

export function registerToolsUserSecurity(mcpServer) {
  // chatter/me 取用户 Id 再 SOQL 查 User
  mcpServer.tool(
    "get_current_user_info",
    "查询当前登录用户的基础信息：Id、Username、Email、Name 等（只读）。",
    {},
    async () => {
      const meInfo = await sfRestGet(CHATTER_ME_PATH);
      const userId = meInfo.id;
      if (!userId) {
        return textContent({
          error: "无法从 chatter/users/me 响应中获取当前用户 Id"
        });
      }
      const safeUserId = escapeSoqlLiteral(userId);
      const soql = `SELECT Id, Name, Username, Email, UserType, IsActive, Profile.Name, LocaleSidKey, TimeZoneSidKey, LanguageLocaleKey FROM User WHERE Id = '${safeUserId}'`;
      const resultData = await sfQueryAll(soql);
      const recList = resultData.records || [];
      if (recList.length === 0) {
        return textContent({ error: `没有查到 Id 为 ${userId} 的 User 记录` });
      }
      const rec = recList[0];
      const profile = rec.Profile || {};
      return textContent({
        Id: rec.Id || "",
        Name: rec.Name || "",
        Username: rec.Username || "",
        Email: rec.Email || "",
        UserType: rec.UserType || "",
        IsActive: rec.IsActive || false,
        ProfileName: profile.Name || "",
        LocaleSidKey: rec.LocaleSidKey || "",
        TimeZoneSidKey: rec.TimeZoneSidKey || "",
        LanguageLocaleKey: rec.LanguageLocaleKey || ""
      });
    }
  );
  // Organization 单条，取 Org 基础信息
  mcpServer.tool(
    "get_org_info",
    "查询当前 Org 的基础信息（只读）。",
    {},
    async () => {
      const soql =
        "SELECT Id, Name, InstanceName, OrganizationType, IsSandbox, DefaultLocaleSidKey, TimeZoneSidKey FROM Organization LIMIT 1";
      const resultData = await sfQueryAll(soql);
      const orgList = resultData.records || [];
      if (orgList.length === 0) {
        return textContent({ error: "Organization record not found" });
      }
      const orgRec = orgList[0];
      return textContent({
        Id: orgRec.Id || "",
        Name: orgRec.Name || "",
        InstanceName: orgRec.InstanceName || "",
        OrganizationType: orgRec.OrganizationType || "",
        IsSandbox: orgRec.IsSandbox || false,
        DefaultLocaleSidKey: orgRec.DefaultLocaleSidKey || "",
        TimeZoneSidKey: orgRec.TimeZoneSidKey || ""
      });
    }
  );
  // User 列表，可选 isActive 与 limit
  mcpServer.tool(
    "list_users",
    "查询用户列表（只读）。可按是否激活过滤，限制条数（最大 200）。",
    {
      isActive: z.boolean().optional(),
      limit: z.number().optional().default(50)
    },
    async ({ isActive, limit }) => {
      const safeLimit = limitValue(limit, DEFAULT_LIMIT_MAX);
      let whereSql = "";
      if (isActive !== undefined && isActive !== null) {
        whereSql = `WHERE IsActive = ${isActive}`;
      }
      const soql = `SELECT Id, Name, Username, Email, IsActive, UserType, Profile.Name, UserRole.Name FROM User ${whereSql} ORDER BY LastModifiedDate DESC LIMIT ${safeLimit}`;
      const resultData = await sfQueryAll(soql);
      const userList = (resultData.records || []).map((rec) => {
        const profileData = rec.Profile || {};
        const roleData = rec.UserRole || {};
        return {
          Id: rec.Id || "",
          Name: rec.Name || "",
          Username: rec.Username || "",
          Email: rec.Email || "",
          IsActive: rec.IsActive || false,
          UserType: rec.UserType || "",
          ProfileName: profileData.Name || "",
          UserRoleName: roleData.Name || ""
        };
      });
      return textContent(userList);
    }
  );
  // 按 userId 查 User 详情
  mcpServer.tool(
    "get_user_detail",
    "查询指定 User 的详细信息（只读）。",
    { userId: z.string() },
    async ({ userId }) => {
      const safeUserId = escapeSoqlLiteral(userId);
      const soql = `SELECT Id, Name, Username, Email, UserType, IsActive, Profile.Name, UserRole.Name, LocaleSidKey, TimeZoneSidKey, LanguageLocaleKey, LastLoginDate, CreatedDate FROM User WHERE Id = '${safeUserId}'`;
      const resultData = await sfQueryAll(soql);
      const userList = resultData.records || [];
      if (userList.length === 0) {
        return textContent({ error: `User '${userId}' not found` });
      }
      const rec = userList[0];
      const profileData = rec.Profile || {};
      const roleData = rec.UserRole || {};
      return textContent({
        Id: rec.Id || "",
        Name: rec.Name || "",
        Username: rec.Username || "",
        Email: rec.Email || "",
        UserType: rec.UserType || "",
        IsActive: rec.IsActive || false,
        ProfileName: profileData.Name || "",
        UserRoleName: roleData.Name || "",
        LocaleSidKey: rec.LocaleSidKey || "",
        TimeZoneSidKey: rec.TimeZoneSidKey || "",
        LanguageLocaleKey: rec.LanguageLocaleKey || "",
        LastLoginDate: rec.LastLoginDate || "",
        CreatedDate: rec.CreatedDate || ""
      });
    }
  );
  // Profile 列表
  mcpServer.tool(
    "list_profiles",
    "查询当前 Org 中所有 Profile（只读）。",
    {},
    async () => {
      const soql = "SELECT Id, Name, Description FROM Profile ORDER BY Name";
      const resultData = await sfQueryAll(soql);
      const profileList = (resultData.records || []).map((rec) => ({
        Id: rec.Id || "",
        Name: rec.Name || "",
        Description: rec.Description || ""
      }));
      return textContent(profileList);
    }
  );
  // PermissionSet 列表
  mcpServer.tool(
    "list_permission_sets",
    "查询当前 Org 中所有 PermissionSet（只读）。",
    {},
    async () => {
      const soql =
        "SELECT Id, Name, Label, Description, IsOwnedByProfile FROM PermissionSet ORDER BY Label";
      const resultData = await sfQueryAll(soql);
      const permList = (resultData.records || []).map((rec) => ({
        Id: rec.Id || "",
        Name: rec.Name || "",
        Label: rec.Label || "",
        Description: rec.Description || "",
        IsOwnedByProfile: rec.IsOwnedByProfile || false
      }));
      return textContent(permList);
    }
  );
  // Profile 对某对象的 Object 权限
  async function getObjectPermForProfile(objName, profileId) {
    const safeObj = escapeSoqlLiteral(objName);
    const safeProfileId = escapeSoqlLiteral(profileId);
    const soql = `SELECT PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords, Parent.ProfileId, SObjectType FROM ObjectPermissions WHERE Parent.ProfileId = '${safeProfileId}' AND SObjectType = '${safeObj}'`;
    const resultData = await sfToolingQuery(soql);
    const permList = resultData.records || [];
    if (permList.length === 0) {
      return { objectName: objName, profileId, hasPermissionRecord: false };
    }
    const rec = permList[0];
    return {
      objectName: objName,
      profileId,
      hasPermissionRecord: true,
      canCreate: rec.PermissionsCreate || false,
      canRead: rec.PermissionsRead || false,
      canEdit: rec.PermissionsEdit || false,
      canDelete: rec.PermissionsDelete || false,
      viewAllRecords: rec.PermissionsViewAllRecords || false,
      modifyAllRecords: rec.PermissionsModifyAllRecords || false
    };
  }
  // 暴露 getObjectPermForProfile
  mcpServer.tool(
    "get_object_permissions_for_profile",
    "查询指定 Profile 对某对象的权限：对象级 CRUD、ViewAll/ModifyAll（只读）。",
    { objName: z.string(), profileId: z.string() },
    async ({ objName, profileId }) => {
      const out = await getObjectPermForProfile(objName, profileId);
      return textContent(out);
    }
  );
  // Profile + PermissionSet 对象权限做 OR 汇总
  mcpServer.tool(
    "get_object_permissions_for_user",
    "查询某用户对指定对象的权限概览（只读）。聚合 Profile 与 PermissionSet 做 OR。",
    { objName: z.string(), userId: z.string() },
    async ({ objName, userId }) => {
      const safeUserId = escapeSoqlLiteral(userId);
      const safeObj = escapeSoqlLiteral(objName);
      const userSoql = `SELECT Id, ProfileId FROM User WHERE Id = '${safeUserId}'`;
      const userResultData = await sfQueryAll(userSoql);
      const userList = userResultData.records || [];
      if (userList.length === 0) {
        return textContent({ error: `User '${userId}' not found` });
      }
      const profileId = userList[0].ProfileId;
      const profilePerm = await getObjectPermForProfile(objName, profileId);
      const permSoql = `SELECT PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords, SObjectType FROM ObjectPermissions WHERE ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${safeUserId}') AND SObjectType = '${safeObj}'`;
      const permResultData = await sfToolingQuery(permSoql);
      const psPermList = permResultData.records || [];
      function boolOr(psKey) {
        const profileKey = PROFILE_TO_PS_KEY_MAP[psKey] || psKey;
        const baseVal = Boolean(profilePerm[profileKey]);
        for (const item of psPermList) {
          if (item[psKey]) return true;
        }
        return baseVal;
      }
      return textContent({
        objectName: objName,
        userId,
        profileId,
        fromProfile: profilePerm,
        permissionSetCount: psPermList.length,
        effective: {
          canCreate: boolOr("PermissionsCreate"),
          canRead: boolOr("PermissionsRead"),
          canEdit: boolOr("PermissionsEdit"),
          canDelete: boolOr("PermissionsDelete"),
          viewAllRecords: boolOr("PermissionsViewAllRecords"),
          modifyAllRecords: boolOr("PermissionsModifyAllRecords")
        }
      });
    }
  );
  // Profile 对某字段的 FieldPermissions
  mcpServer.tool(
    "get_field_level_security_for_profile",
    "查询指定 Profile 对某字段的字段级安全：readable/editable（只读）。",
    {
      objName: z.string(),
      fieldName: z.string(),
      profileId: z.string()
    },
    async ({ objName, fieldName, profileId }) => {
      const safeObj = escapeSoqlLiteral(objName);
      const safeField = escapeSoqlLiteral(fieldName);
      const safeFullName = `${safeObj}.${safeField}`;
      const safeProfileId = escapeSoqlLiteral(profileId);
      const soql = `SELECT Parent.ProfileId, SObjectType, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE Parent.ProfileId = '${safeProfileId}' AND SObjectType = '${safeObj}' AND Field = '${safeFullName}'`;
      const resultData = await sfToolingQuery(soql);
      const permList = resultData.records || [];
      if (permList.length === 0) {
        return textContent({
          objectName: objName,
          fieldName,
          profileId,
          hasPermissionRecord: false
        });
      }
      const rec = permList[0];
      return textContent({
        objectName: objName,
        fieldName,
        profileId,
        hasPermissionRecord: true,
        readable: rec.PermissionsRead || false,
        editable: rec.PermissionsEdit || false
      });
    }
  );
  // Profile + PermissionSet 字段权限做 OR
  mcpServer.tool(
    "get_field_level_security_for_user",
    "查询某用户对指定字段的字段级安全（只读）。聚合 Profile 与 PermissionSet。",
    {
      objName: z.string(),
      fieldName: z.string(),
      userId: z.string()
    },
    async ({ objName, fieldName, userId }) => {
      const safeObj = escapeSoqlLiteral(objName);
      const safeField = escapeSoqlLiteral(fieldName);
      const safeFullName = `${safeObj}.${safeField}`;
      const safeUserId = escapeSoqlLiteral(userId);
      const userSoql = `SELECT Id, ProfileId FROM User WHERE Id = '${safeUserId}'`;
      const userResultData = await sfQueryAll(userSoql);
      const userList = userResultData.records || [];
      if (userList.length === 0) {
        return textContent({ error: `User '${userId}' not found` });
      }
      const profileId = userList[0].ProfileId;
      const safeProfileId = escapeSoqlLiteral(profileId);
      const profileFlsRes = await (async () => {
        const soql = `SELECT Parent.ProfileId, SObjectType, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE Parent.ProfileId = '${safeProfileId}' AND SObjectType = '${safeObj}' AND Field = '${safeFullName}'`;
        const resultData = await sfToolingQuery(soql);
        const permList = resultData.records || [];
        if (permList.length === 0) {
          return { objectName: objName, fieldName, profileId, hasPermissionRecord: false, readable: false, editable: false };
        }
        const rec = permList[0];
        return { objectName: objName, fieldName, profileId, hasPermissionRecord: true, readable: rec.PermissionsRead || false, editable: rec.PermissionsEdit || false };
      })();
      const permSoql = `SELECT SObjectType, Field, PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${safeUserId}') AND SObjectType = '${safeObj}' AND Field = '${safeFullName}'`;
      const permResultData = await sfToolingQuery(permSoql);
      const psPermList = permResultData.records || [];
      let effReadable = Boolean(profileFlsRes.readable);
      let effEditable = Boolean(profileFlsRes.editable);
      for (const rec of psPermList) {
        if (rec.PermissionsRead) effReadable = true;
        if (rec.PermissionsEdit) effEditable = true;
      }
      return textContent({
        objectName: objName,
        fieldName,
        userId,
        profileId,
        fromProfile: profileFlsRes,
        permissionSetCount: psPermList.length,
        effective: { readable: effReadable, editable: effEditable }
      });
    }
  );
  // LoginHistory 按 userId 与 limit 查询
  mcpServer.tool(
    "get_login_history",
    "查询指定用户最近的登录历史：LoginHistory（只读）。",
    { userId: z.string(), limit: z.number().optional().default(20) },
    async ({ userId, limit }) => {
      const safeLimit = limitValue(limit, DEFAULT_LIMIT_MAX);
      const safeUserId = escapeSoqlLiteral(userId);
      const soql = `SELECT Id, LoginTime, SourceIp, LoginType, Status FROM LoginHistory WHERE UserId = '${safeUserId}' ORDER BY LoginTime DESC LIMIT ${safeLimit}`;
      try {
        const resultData = await sfQueryAll(soql);
        const historyList = (resultData.records || []).map((rec) => ({
          Id: rec.Id || "",
          LoginTime: rec.LoginTime || "",
          SourceIp: rec.SourceIp || "",
          LoginType: rec.LoginType || "",
          Status: rec.Status || ""
        }));
        return textContent(historyList);
      } catch (exc) {
        const errMsg = (exc && exc.message) ? exc.message : String(exc);
        return textContent({
          error: `LoginHistory query failed: ${errMsg}`
        });
      }
    }
  );
  // 汇总用户详情 + 对象权限 + 多字段 FLS
  mcpServer.tool(
    "get_user_access_overview",
    "汇总某用户对指定对象及字段的访问概览（只读）。",
    {
      userId: z.string(),
      objName: z.string(),
      fieldNameList: z.array(z.string()).optional()
    },
    async ({ userId, objName, fieldNameList }) => {
      const overview = { userId, objectName: objName, success: true };
      const safeUserId = escapeSoqlLiteral(userId);
      const safeObj = escapeSoqlLiteral(objName);
      try {
        const soql = `SELECT Id, Name, Username, Email, UserType, IsActive, Profile.Name, UserRole.Name, LocaleSidKey, TimeZoneSidKey, LanguageLocaleKey, LastLoginDate, CreatedDate FROM User WHERE Id = '${safeUserId}'`;
        const resultData = await sfQueryAll(soql);
        const userList = resultData.records || [];
        overview.userDetail =
          userList.length === 0
            ? { error: `User '${userId}' not found` }
            : {
                Id: userList[0].Id,
                Name: userList[0].Name,
                Username: userList[0].Username,
                Email: userList[0].Email,
                UserType: userList[0].UserType,
                IsActive: userList[0].IsActive,
                ProfileName: userList[0].Profile?.Name || "",
                UserRoleName: userList[0].UserRole?.Name || "",
                LocaleSidKey: userList[0].LocaleSidKey || "",
                TimeZoneSidKey: userList[0].TimeZoneSidKey || "",
                LanguageLocaleKey: userList[0].LanguageLocaleKey || "",
                LastLoginDate: userList[0].LastLoginDate || "",
                CreatedDate: userList[0].CreatedDate || ""
              };
      } catch (exc) {
        overview.success = false;
        overview.userDetailError = String(exc);
      }

      try {
        const userSoql = `SELECT Id, ProfileId FROM User WHERE Id = '${safeUserId}'`;
        const userResultData = await sfQueryAll(userSoql);
        const userList = userResultData.records || [];
        if (userList.length > 0) {
          const profileId = userList[0].ProfileId;
          const profilePerm = await getObjectPermForProfile(objName, profileId);
          const permSoql = `SELECT PermissionsCreate, PermissionsRead, PermissionsEdit, PermissionsDelete, PermissionsViewAllRecords, PermissionsModifyAllRecords FROM ObjectPermissions WHERE ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${safeUserId}') AND SObjectType = '${safeObj}'`;
          const permResultData = await sfToolingQuery(permSoql);
          const psPermList = permResultData.records || [];
          function boolOr(psKey) {
            const profileKey = PROFILE_TO_PS_KEY_MAP[psKey] || psKey;
            const baseVal = Boolean(profilePerm[profileKey]);
            for (const item of psPermList) {
              if (item[psKey]) return true;
            }
            return baseVal;
          }
          overview.objectPermissions = {
            objectName: objName,
            userId,
            profileId,
            fromProfile: profilePerm,
            permissionSetCount: psPermList.length,
            effective: {
              canCreate: boolOr("PermissionsCreate"),
              canRead: boolOr("PermissionsRead"),
              canEdit: boolOr("PermissionsEdit"),
              canDelete: boolOr("PermissionsDelete"),
              viewAllRecords: boolOr("PermissionsViewAllRecords"),
              modifyAllRecords: boolOr("PermissionsModifyAllRecords")
            }
          };
        } else {
          overview.objectPermissions = { error: `User '${userId}' not found` };
        }
      } catch (exc) {
        overview.success = false;
        overview.objectPermissionsError = String(exc);
      }

      overview.fieldLevelSecurityList = [];
      if (fieldNameList && fieldNameList.length > 0) {
        for (const fname of fieldNameList) {
          try {
            const safeFname = escapeSoqlLiteral(fname);
            const safeFullName = `${safeObj}.${safeFname}`;
            const userSoql = `SELECT Id, ProfileId FROM User WHERE Id = '${safeUserId}'`;
            const userResultData = await sfQueryAll(userSoql);
            const userList = userResultData.records || [];
            if (userList.length === 0) {
              overview.fieldLevelSecurityList.push({
                objectName: objName,
                fieldName: fname,
                userId,
                error: "User not found"
              });
              overview.success = false;
              continue;
            }
            const profileId = userList[0].ProfileId;
            const safeProfileId = escapeSoqlLiteral(profileId);
            const flsSoql = `SELECT PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE Parent.ProfileId = '${safeProfileId}' AND SObjectType = '${safeObj}' AND Field = '${safeFullName}'`;
            const flsResult = await sfToolingQuery(flsSoql);
            const psFlsSoql = `SELECT PermissionsRead, PermissionsEdit FROM FieldPermissions WHERE ParentId IN (SELECT PermissionSetId FROM PermissionSetAssignment WHERE AssigneeId = '${safeUserId}') AND SObjectType = '${safeObj}' AND Field = '${safeFullName}'`;
            const psFlsResult = await sfToolingQuery(psFlsSoql);
            let readable = (flsResult.records || []).some((r) => r.PermissionsRead);
            let editable = (flsResult.records || []).some((r) => r.PermissionsEdit);
            for (const r of psFlsResult.records || []) {
              if (r.PermissionsRead) readable = true;
              if (r.PermissionsEdit) editable = true;
            }
            overview.fieldLevelSecurityList.push({
              objectName: objName,
              fieldName: fname,
              userId,
              profileId,
              effective: { readable, editable }
            });
          } catch (exc) {
            overview.fieldLevelSecurityList.push({
              objectName: objName,
              fieldName: fname,
              userId,
              error: String(exc)
            });
            overview.success = false;
          }
        }
      }
      return textContent(overview);
    }
  );
}
