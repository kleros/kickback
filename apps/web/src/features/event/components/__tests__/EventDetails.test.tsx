import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { EventDetailsView, type EventDetailsProps } from "@/components/EventDetailsView";

const props: EventDetailsProps = {
  details: {
    title: "Dinner",
    name: null,
    when: "Friday evening",
    where: "Café & Hall #2",
    hosts: ["Friends"],
    link: "https://luma.com/dinner",
    infoPath: null,
  },
  description: "A plain description.",
  links: [{ label: "Host website", url: "https://example.com/hosts" }],
};

describe("event details presentation", () => {
  it("renders cover, title, hosts, domains, and preview metadata as text", () => {
    render(
      <EventDetailsView
        {...props}
        coverUrl="blob:verified"
        preview={{ title: "Registration title", siteName: "Luma", image: "/api/preview/image?url=test" }}
      />,
    );
    expect(screen.getByRole("heading", { name: "Dinner" })).toBeVisible();
    expect(screen.getByText("Friends")).toBeVisible();
    expect(screen.getByText("luma.com")).toBeVisible();
    expect(screen.getByText("example.com")).toBeVisible();
    expect(screen.getByRole("link", { name: /Registration title/ })).toHaveAttribute("href", "https://luma.com/dinner");
    expect(document.querySelector(".ed-cover")).toHaveAttribute("src", "blob:verified");
  });

  it("shows the venue map on load, sandboxed and lazy", () => {
    render(<EventDetailsView {...props} />);
    expect(screen.queryByRole("button", { name: "Show map" })).toBeNull();
    const map = screen.getByTitle("Map of Café & Hall #2");
    expect(map).toHaveAttribute("src", "https://www.google.com/maps?q=Caf%C3%A9%20%26%20Hall%20%232&output=embed");
    expect(map).toHaveAttribute("sandbox", "allow-scripts allow-same-origin allow-popups");
    expect(map).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(map).toHaveAttribute("loading", "lazy");
  });

  it("hides empty parts and uses a plain link when a preview is unavailable", () => {
    render(
      <EventDetailsView {...props} details={{ ...props.details, where: null, hosts: [] }} description="" links={[]} />,
    );
    expect(screen.getByRole("link", { name: /Open registration/ })).toHaveTextContent("luma.com");
    expect(document.querySelector("iframe")).toBeNull();
    expect(screen.queryByLabelText("Hosts")).toBeNull();
    expect(screen.queryByLabelText("Extra links")).toBeNull();
    expect(document.querySelector("img")).toBeNull();
  });

  it("renders organiser markup literally and never creates active elements", async () => {
    const hostile = '<img src=x onerror="alert(1)">';
    render(
      <EventDetailsView
        {...props}
        details={{ ...props.details, title: hostile, hosts: [hostile], link: "javascript:alert(1)" }}
        description={hostile.repeat(20)}
        links={[{ label: hostile, url: "javascript:alert(1)" }]}
      />,
    );
    expect(document.querySelector("img")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
    const more = screen.getByRole("button", { name: "Read more" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("heading", { name: hostile })).toBeVisible();
  });
});
