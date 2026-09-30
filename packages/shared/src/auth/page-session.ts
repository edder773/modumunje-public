export type LearnerPageSession =
  | {
      status: "guest";
      displayName: string;
      userKey: string;
      signInPath: string;
    }
  | {
      status: "active";
      displayName: string;
      userKey: string;
      adminAccess: boolean;
      groupExamAccess: boolean;
      signInPath: string;
      signOutPath: string;
    }
  | {
      status: "blocked";
      blockedReason: string;
      signOutPath: string;
    };

export type AdminPageSession =
  | {
      status: "authorized";
      displayName: string;
      signOutPath: string;
    }
  | {
      status: "forbidden";
      signOutPath: string;
    };
