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

package store

// CanonicalArea is one entry in the curated OCF location list.
type CanonicalArea struct {
	// Slug is the immutable identifier (derived from Name, apostrophes dropped).
	Slug string
	// Name is the display name.
	Name string
}

// CanonicalAreas is the curated OCF location list (real fairground areas,
// stages, streets, and gates), flat with no nesting and sorted A–Z by Name. It
// is the single source of truth for the areas every newly-created event is
// populated with (see the event-create handler), so production gets the real
// area set without any seed file or manual entry — areas appear the moment an
// admin creates the event.
//
// The slugs and order here mirror the dev/demo seed's AREA rows for event 1; an
// integration test (TestSeedAreasMatchCanonical) guards the two against drift.
// A new area's SORT_ORDER is its index in this slice.
var CanonicalAreas = []CanonicalArea{
	{"abbey-rode", "Abbey Rode"},
	{"aero-road", "Aero Road"},
	{"alices-wonderland", "Alice's Wonderland"},
	{"ark-park", "Ark Park"},
	{"auntie-em-bridge", "Auntie Em Bridge"},
	{"aurora-corridora", "Aurora Corridora"},
	{"blue-moon-stage", "Blue Moon Stage"},
	{"breeze-way", "Breeze Way"},
	{"bus-road", "Bus Road"},
	{"cabal-gate", "Cabal Gate"},
	{"caravan-stage", "Caravan Stage"},
	{"chasem-road", "Chasem Road"},
	{"chela-mela", "Chela Mela"},
	{"chez-rays", "Chez Rays"},
	{"chickadee-lane", "Chickadee Lane"},
	{"community-village", "Community Village"},
	{"community-village-stage", "Community Village Stage"},
	{"dance-pavilion", "Dance Pavilion"},
	{"dead-lot", "Dead Lot"},
	{"despain-lane", "DeSpain Lane"},
	{"dragon-plaza", "Dragon Plaza"},
	{"ducaniveaux-vaudeville-palace", "DuCaniveaux Vaudeville Palace"},
	{"east-13th", "East 13th"},
	{"elders-meadow", "Elder's Meadow"},
	{"elders-trail-flamingo-road", "Elder's Trail (Flamingo Road)"},
	{"energy-park", "Energy Park"},
	{"entertainment-camp", "Entertainment Camp"},
	{"far-side", "Far Side"},
	{"far-side-bridge", "Far Side Bridge"},
	{"far-side-path", "Far Side Path"},
	{"front-porch", "Front Porch"},
	{"hoarse-chorale", "Hoarse Chorale"},
	{"jills-crossing", "Jill's Crossing"},
	{"kermits-lot", "Kermit's Lot"},
	{"kesey-stage", "Kesey Stage"},
	{"labyrinth", "Labyrinth"},
	{"leslies-lead", "Leslie's Lead"},
	{"main-camp-qm", "Main Camp/QM"},
	{"main-stage", "Main Stage"},
	{"main-stage-meadow", "Main Stage Meadow"},
	{"marshalls-landing", "Marshall's Landing"},
	{"maui-island", "Maui Island"},
	{"monkey-palace", "Monkey Palace"},
	{"moon-path", "Moon Path"},
	{"morningwood-odditorium", "Morningwood Odditorium"},
	{"nansleez-road", "Nansleez Road"},
	{"north-miss-piggy", "North Miss Piggy"},
	{"odyssey", "Odyssey"},
	{"outta-site-lot", "Outta Site Lot"},
	{"peach-gate-bag-check", "Peach Gate (Bag Check)"},
	{"phun-way", "Phun Way"},
	{"pike-street", "Pike Street"},
	{"pyrates-cove", "Pyrate's Cove"},
	{"rabbit-hole", "Rabbit Hole"},
	{"refer-bridge", "Refer Bridge"},
	{"ruff-road", "Ruff Road"},
	{"sallies-alley", "Sallie's Alley"},
	{"scof-lot", "Scof Lot"},
	{"sesame-street", "Sesame Street"},
	{"shady-lane", "Shady Lane"},
	{"snivel-smile-road", "Snivel/Smile Road"},
	{"snooze-gate", "Snooze Gate"},
	{"south-miss-piggy", "South Miss Piggy"},
	{"south-park-road", "South Park Road"},
	{"south-woods", "South Woods"},
	{"spirit-tower", "Spirit Tower"},
	{"stage-left", "Stage Left"},
	{"star-lane", "Star Lane"},
	{"steward-ship", "Steward Ship"},
	{"strawberry-lane", "Strawberry Lane"},
	{"sun-path", "Sun Path"},
	{"the-alcove-kocf", "The Alcove - KOCF"},
	{"the-ball-field", "The Ball Field"},
	{"the-hub", "The Hub"},
	{"the-junction", "The Junction"},
	{"the-left-bank", "The Left Bank"},
	{"the-ritz", "The Ritz"},
	{"tower-lot", "Tower Lot"},
	{"traffic-camp", "Traffic Camp"},
	{"trotters-field", "Trotter's Field"},
	{"w-c-fields-stage", "W.C. Fields Stage"},
	{"wallys-way", "Wally's Way"},
	{"water-gate", "Water Gate"},
	{"white-bird-big-bird", "White Bird Big Bird"},
	{"white-bird-little-wing", "White Bird Little Wing"},
	{"wind-gate", "Wind Gate"},
	{"wood-world", "Wood World"},
	{"wooten-way", "Wooten Way"},
	{"workit-shop", "WorkIt Shop"},
	{"xavanadu", "Xavanadu"},
	{"youth-stage", "Youth Stage"},
	{"zen-barn", "Zen Barn"},
}
