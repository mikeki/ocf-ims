//
// See the file COPYRIGHT for copyright information.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

import { render, screen } from "@testing-library/react-native";
import Index from "../app/index";

// The 3a.1 harness proof: jest-expo renders a route, and the route reads a
// value out of the generated proto descriptor — so Jest resolves the workspace
// package through its `exports` map just as Metro and tsc do.
describe("the index route", () => {
  it("renders the app name and the ImsService type name", async () => {
    // RNTL 14: render is async (React 19 act semantics); `screen` is bound
    // only once it resolves.
    await render(<Index />);
    screen.getByText("OCF IMS");
    screen.getByText("ocf.ims.service.v1.ImsService");
  });
});
