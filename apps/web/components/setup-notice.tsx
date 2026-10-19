import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export function SetupNotice({ message }: { message: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Finish setup</CardTitle>
        <CardDescription>{message}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <p>
          Copy <code>apps/web/.env.example</code> to <code>.env.local</code> and fill in the ESPN
          cookies (<code>espn_s2</code>, <code>SWID</code>) from a signed-in browser: DevTools →
          Application → Cookies → fantasy.espn.com. On Vercel, set the same variables in Project
          Settings → Environment Variables.
        </p>
        <p className="text-muted-foreground">
          The cookies last about a year. When ESPN starts answering 401, copy them again.
        </p>
      </CardContent>
    </Card>
  );
}

export function ErrorNotice({ title, message }: { title: string; message: string }) {
  return (
    <Card className="border-destructive/50">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription className="break-words">{message}</CardDescription>
      </CardHeader>
    </Card>
  );
}
