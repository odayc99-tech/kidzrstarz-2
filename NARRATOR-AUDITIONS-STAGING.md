# Compare narrator voices on staging

Open `/admin/narrators` on the test site using the existing administrator login. This is an audition page, not a change to customer orders or the current default narrator.

Jade is the playful candidate, Darian is the warm storytelling candidate, and Talia is the soft bedtime candidate. These roles are recommendations based on ElevenLabs' descriptions; listen before deciding which suits your families. All three use the same fictional passage, `eleven_multilingual_v2`, and identical settings so the voice—not different story text—is the main comparison.

Confirm the credit notice, then generate each short sample and press Play when ready. Preparing an uncached sample uses the existing ElevenLabs account's credits; replay uses the stored private sample. Only one audition plays at a time. No personal voice is cloned, no library voice is automatically added, and no plan or subscription is changed. If the account/model cannot access a voice, the page reports that problem rather than substituting a different voice.

Listen first without music. Can you understand every word? Does it sound inviting rather than shrill or rushed? Does the dialogue feel lively? Would the calmer option suit bedtime? If possible, ask a parent and a child in the target age group which voice they want to hear again. A preference from this short test does not prove a sales or learning benefit.

Sarah and the old ElevenLabs Default voices are scheduled to retire on December 31, 2026. That is a reason to choose and test a replacement, not an automatic migration. Once you choose your preferred voices, a separate staging change can add them to the creation form and preserve each new story's narrator choice. Use My Voice, existing stories/music/downloads and production remain unchanged during auditions.

## Sources

- [Official default voice replacements and retirement notice](https://elevenlabs.io/docs/help-center/product/voices/my-voices/what-are-default-voices)
- [Native speech API and format/settings](https://elevenlabs.io/docs/api-reference/text-to-speech/convert)
- [Voice-setting guidance](https://elevenlabs.io/docs/eleven-creative/playground/text-to-speech)

## Storage prerequisite

The cache needs `s3:ListBucket` as well as object read/write so S3 can distinguish a genuinely missing clip from denied access. The previously configured `kidzrstarz-staging` IAM policy includes that bucket permission; no DeleteObject permission or AWS policy change is required. If effective permissions differ or a bucket policy denies the request, preparation stops without spending voice credits. Actual first-generation success and voice eligibility still need the owner's explicit staging test.
