import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "./pages/Home";
import { Display } from "./pages/Display";
import { Join } from "./pages/Join";
import { SpotifyCallback } from "./pages/SpotifyCallback";
import { Admin } from "./pages/Admin";
import { Solo } from "./pages/Solo";

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/display" element={<Display />} />
        <Route path="/solo" element={<Solo />} />
        <Route path="/join/:code" element={<Join />} />
        <Route path="/spotify/callback" element={<SpotifyCallback />} />
        <Route path="/admin" element={<Admin />} />
        <Route path="*" element={<Home />} />
      </Routes>
    </BrowserRouter>
  );
}
