import { useState, useEffect } from "react";
import { Outlet, useLoaderData } from "@remix-run/react";
import type { LoaderFunctionArgs, MetaFunction } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useNavigate } from "@remix-run/react";

import { requireSession } from "@/lib/services";
import { DashHeader } from "@/components/common";
import { getKey } from "@/lib/services/keydb-service";

export const meta: MetaFunction = () => {
  return [{ title: "SnapSafe | Dashboard" }];
};

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireSession(request);
  return json({ user: session.user });
}

export default function DashLayout() {
  const { user } = useLoaderData<typeof loader>();
  const navigate = useNavigate();

  useEffect(() => {
    getKey(user.id, user.id).then((key) => {
      if (
        !key &&
        ![
          "/dash/confirm-password",
          "/dash/onboarding/password",
          "/dash/onboarding/password-set",
          "/dash/onboarding/name",
        ].includes(window.location.pathname)
      ) {
        navigate("/dash/confirm-password");
        return;
      }
    });
  }, [user.id]);
  return (
    <div>
      <DashHeader user={user} />
      <Outlet context={user} />
    </div>
  );
}
