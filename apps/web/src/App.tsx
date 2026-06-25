import { useState } from "react";
import { ProjectListPage } from "./routes/ProjectListPage";
import { ProjectEditorPage } from "./routes/ProjectEditorPage";

type Route =
  | { page: "list" }
  | { page: "editor"; projectId: string };

export default function App() {
  const [route, setRoute] = useState<Route>({ page: "list" });

  if (route.page === "editor") {
    return (
      <ProjectEditorPage
        projectId={route.projectId}
        onBack={() => setRoute({ page: "list" })}
      />
    );
  }

  return (
    <ProjectListPage onOpen={(id) => setRoute({ page: "editor", projectId: id })} />
  );
}
