import { CaretDown, DotsThree } from "@phosphor-icons/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export function DesignSystemRoute() {
  const [emailAlerts, setEmailAlerts] = useState(true);
  const [betaAccess, setBetaAccess] = useState(false);
  const [newsletter, setNewsletter] = useState(true);

  return (
    <section aria-label="Design system" className="px-8 py-8 md:px-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <div className="flex flex-col gap-3">
          <Badge variant="secondary" className="w-fit">
            Design System
          </Badge>
          <div className="flex max-w-3xl flex-col gap-2">
            <h1 className="font-heading text-3xl tracking-tight">Core component inventory</h1>
            <p className="text-sm text-muted-foreground">
              A working reference for the primitives we can use across the app, built from the
              installed shadcn base components.
            </p>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Buttons</CardTitle>
              <CardDescription>
                Primary actions, secondary actions, and low-emphasis affordances.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-3">
                <Button>Default</Button>
                <Button variant="outline">Outline</Button>
                <Button variant="secondary">Secondary</Button>
                <Button variant="ghost">Ghost</Button>
                <Button variant="destructive">Destructive</Button>
                <Button variant="link">Link</Button>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button size="xs">Extra small</Button>
                <Button size="sm">Small</Button>
                <Button size="default">Default</Button>
                <Button size="lg">Large</Button>
                <Button aria-label="More actions" size="icon-sm" variant="outline">
                  <DotsThree weight="bold" />
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Badges</CardTitle>
              <CardDescription>Compact status and category treatments.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <Badge>Default</Badge>
              <Badge variant="secondary">Secondary</Badge>
              <Badge variant="outline">Outline</Badge>
              <Badge variant="destructive">Destructive</Badge>
              <Badge variant="ghost">Ghost</Badge>
              <Badge variant="link">Link</Badge>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Inputs</CardTitle>
              <CardDescription>Base text input treatments for forms and filtering.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Input defaultValue="alex@loopndroll.dev" type="email" />
              <Input placeholder="Search projects" />
              <Input aria-invalid defaultValue="Invalid state" />
              <Input disabled value="Disabled input" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Select</CardTitle>
              <CardDescription>
                Standard single-select control for app settings and forms.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <Select defaultValue="dark">
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose theme" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Theme</SelectLabel>
                    <SelectItem value="light">Light</SelectItem>
                    <SelectItem value="dark">Dark</SelectItem>
                    <SelectItem value="system">System</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Select defaultValue="compact">
                <SelectTrigger className="w-full" size="sm">
                  <SelectValue placeholder="Density" />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectLabel>Density</SelectLabel>
                    <SelectItem value="comfortable">Comfortable</SelectItem>
                    <SelectItem value="compact">Compact</SelectItem>
                    <SelectItem value="tight">Tight</SelectItem>
                  </SelectGroup>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dropdown menu</CardTitle>
              <CardDescription>Context actions, filters, and quick menu patterns.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-3">
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={
                    <Button variant="outline">
                      Actions
                      <CaretDown data-icon="inline-end" weight="bold" />
                    </Button>
                  }
                />
                <DropdownMenuContent>
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Workspace</DropdownMenuLabel>
                    <DropdownMenuItem>Open project</DropdownMenuItem>
                    <DropdownMenuItem>Duplicate</DropdownMenuItem>
                    <DropdownMenuCheckboxItem checked={newsletter} onCheckedChange={setNewsletter}>
                      Watch updates
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuGroup>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem variant="destructive">Archive workspace</DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Toggles</CardTitle>
              <CardDescription>Binary controls for preferences and access flags.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Email alerts</p>
                  <p className="text-sm text-muted-foreground">Notify when deployments fail.</p>
                </div>
                <Switch checked={emailAlerts} onCheckedChange={setEmailAlerts} />
              </div>
              <div className="flex items-center justify-between gap-4 rounded-lg border border-border/60 px-3 py-3">
                <div className="flex flex-col gap-1">
                  <p className="text-sm font-medium">Beta access</p>
                  <p className="text-sm text-muted-foreground">Enable unreleased components.</p>
                </div>
                <Checkbox checked={betaAccess} onCheckedChange={setBetaAccess} />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </section>
  );
}
