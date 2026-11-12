"""Three end-to-end demo missions, each modelled on a use case Loft Orbital flies today.

Each one is a real place and, for disasters, a real event replayed on the Sentinel-2 images of
that day: the scene ids are pinned so the demo gives the same result every time. The maritime
one runs on the latest clear image instead: ships at anchor are there every day.
"""

from datetime import date

from pydantic import BaseModel


class Source(BaseModel):
    label: str
    url: str


class Demo(BaseModel):
    id: str
    title: str
    tagline: str
    account_id: str  # the tenant that orders it (holds the licence)
    prompt: str  # what the customer types
    intent: str  # what the assistant understood
    app_id: str
    app_reason: str
    place: str
    bbox: list[float]
    event_date: date | None  # None: live, latest clear image
    scene_id: str | None  # image the preview runs on
    reference_id: str | None  # "before" image (fire, flood) or another date (ships)
    story: str  # why it matters, in one or two sentences
    loft_case: str  # the matching use case on Loft's satellites
    sources: list[Source]
    facts: list[str]  # what to look at during the demo


DEMOS: list[Demo] = [
    Demo(
        id="maritime-fos",
        title="Ships at anchor off Marseille-Fos",
        tagline="Maritime domain awareness · live",
        account_id="port-authority-marseille",
        prompt="How many ships are waiting at anchor off the port of Marseille-Fos?",
        intent="Count and size the vessels at anchor in the Gulf of Fos, from now on.",
        app_id="vessel-detection",
        app_reason="HarborEye finds ships in coastal waters and estimates their length: it "
        "turns each pass into a vessel count without downlinking the image.",
        place="Gulf of Fos, Bouches-du-Rhône, France",
        bbox=[4.78, 43.27, 5.06, 43.42],
        event_date=None,
        scene_id=None,
        reference_id=None,
        story="Ships waiting to berth cost demurrage and congest the anchorage. A count per pass "
        "lets a port authority plan berths without waiting for AIS, which some ships switch off.",
        loft_case="Little Place Labs is deploying maritime domain awareness analytics on Loft's "
        "YAM-6 under a US Air Force STTR.",
        sources=[
            Source(label="Loft Orbital: On-orbit AI", url="https://loftorbital.com/on-orbit-ai/")
        ],
        facts=[
            "Runs on the latest clear Sentinel-2 image: the result changes with the traffic.",
            "Rocks and platforms are dropped by checking a second date: ships move, they don't.",
        ],
    ),
    Demo(
        id="wildfire-arganil",
        title="Wildfire front at Arganil, Portugal",
        tagline="Wildfire detection · replay of 16 Aug 2025",
        account_id="fire-service-centro",
        prompt="Alert me to active fire fronts around Arganil, in central Portugal.",
        intent="Detect active fire fronts and the burned area around Arganil, Portugal.",
        app_id="wildfire-detection",
        app_reason="FireSentry detects active flames and maps what has burned: an alert minutes "
        "after the pass instead of hours after the image is downlinked and processed.",
        place="Arganil, Coimbra, Portugal",
        bbox=[-8.05, 40.14, -7.70, 40.38],
        event_date=date(2025, 8, 16),
        scene_id="S2B_29TNE_20250816_0_L2A",
        reference_id="S2A_29TNE_20250803_0_L2A",
        story="In August 2025 the Arganil fire became one of the largest in Portugal's history. "
        "Replay: what an onboard app would have sent from the 16 August pass.",
        loft_case="SmartSat CRC's wildfire detection app (SmokeScout) runs onboard Loft's "
        "AI-enabled satellites for low-latency detection of small smoke signatures.",
        sources=[
            Source(
                label="Loft & SmartSat CRC (Feb 2026)",
                url="https://loftorbital.com/loft-and-smartsat-crc-partner-to-demonstrate-"
                "wildfire-detection-application-onboard-ai-enabled-satellite/",
            )
        ],
        facts=[
            "Sentinel-2 has no thermal band: the preview uses its SWIR bands, where flames "  # noqa: ISC004
            "saturate (HOTMAP test, Murphy et al. 2016).",
            "Burned area = vegetation loss since 3 Aug (dNBR), the last clear image before.",
        ],
    ),
    Demo(
        id="flood-romagna",
        title="Romagna floods, Italy",
        tagline="Flood mapping · replay of 23 May 2023",
        account_id="civil-protection-romagna",
        prompt="Map the flooded areas around Lugo, Emilia-Romagna, after the river overflows.",
        intent="Map flood extent around Lugo (Ravenna) compared with normal conditions.",
        app_id="flood-mapping",
        app_reason="FloodWatch maps flood water against a dry reference image: rivers and lakes "
        "are left out, only the newly flooded land is delivered.",
        place="Lugo, Ravenna, Emilia-Romagna, Italy",
        bbox=[11.80, 44.35, 12.15, 44.60],
        event_date=date(2023, 5, 23),
        scene_id="S2A_32TQQ_20230523_0_L2A",
        reference_id="S2A_32TQQ_20230403_0_L2A",
        story="In May 2023 two storms made rivers burst their banks across Romagna and flooded "
        "towns and farmland for weeks. Replay: the first clear pass, on 23 May.",
        loft_case="Flood mapping is among the AI models flown on the first satellite of the "
        "Orbitworks x Loft Orbital AI constellation.",
        sources=[
            Source(
                label="Orbitworks x Loft AI satellite",
                url="https://analyticsindiamag.com/ai-news/mistral-ai-models-run-aboard-first-"
                "satellite-of-50-satellite-ai-constellation",
            )
        ],
        facts=[
            "Reference: 3 April 2023, the last clear image before the floods.",
            "Light blue is flood (new water); dark blue is the usual rivers, canals and sea.",
        ],
    ),
]

DEMOS_BY_ID = {d.id: d for d in DEMOS}
