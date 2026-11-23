<?php

namespace tests\app\views;

use app\libraries\Core;
use app\libraries\database\DatabaseQueries;
use app\libraries\FileUtils;
use app\libraries\Utils;
use app\models\Config;
use app\models\DateTimeFormat;
use app\models\gradeable\AutoGradedGradeable;
use app\models\gradeable\Gradeable;
use app\models\gradeable\GradedGradeable;
use app\models\gradeable\TaGradedGradeable;
use app\models\User;
use app\views\AutoGradingView;
use tests\BaseUnitTest;
use tests\utils\NullOutput;

class AutoGradingViewTester extends BaseUnitTest {
    private string $tmp_path;
    private string $course_path;

    public function setUp(): void {
        $this->tmp_path = FileUtils::joinPaths(sys_get_temp_dir(), Utils::generateRandomString());
        // convertToAnonPath() takes the 10th path segment to be the submitter id, as in
        // /var/local/submitty/courses/<term>/<course>/<dir>/<gradeable>/<submitter>,
        // so pad the course path out to the same depth
        $padding = 3 - substr_count($this->tmp_path, '/');
        if ($padding < 0) {
            $this->markTestSkipped('The temporary directory is nested too deeply');
        }
        $this->course_path = FileUtils::joinPaths($this->tmp_path, str_repeat('submitty/', $padding) . 'courses/f24/sample');

        $image_path = FileUtils::joinPaths($this->course_path, 'submissions_processed', 'hw1', 'student', '1', 'page_1.png');
        FileUtils::createDir(dirname($image_path), true);
        // 1x1 png, so mime_content_type() sees an image
        file_put_contents($image_path, base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='));

        $annotation_path = FileUtils::joinPaths($this->course_path, 'annotations', 'hw1', 'student', '1', md5($image_path) . '_instructor.json');
        FileUtils::createDir(dirname($annotation_path), true);
        file_put_contents($annotation_path, '[{"typeName":"FrameMarker"}]');
    }

    public function tearDown(): void {
        FileUtils::recursiveRmdir($this->tmp_path);
    }

    /**
     * Renders the TA results for the student and returns the annotated images passed to TAResults.twig
     */
    private function getAnnotationPaths(bool $access_grading, bool $student_download): array {
        $core = $this->createMock(Core::class);

        $user = $this->createMockModel(User::class);
        $user->method('getId')->willReturn('student');
        $user->method('accessGrading')->willReturn($access_grading);
        $core->method('getUser')->willReturn($user);

        $date_time_format = $this->createMockModel(DateTimeFormat::class);
        $date_time_format->method('getFormat')->willReturn('m/d/Y');
        $config = $this->createMockModel(Config::class);
        $config->method('getCoursePath')->willReturn($this->course_path);
        $config->method('getDateTimeFormat')->willReturn($date_time_format);
        $core->method('getConfig')->willReturn($config);

        $queries = $this->createMock(DatabaseQueries::class);
        $queries->method('getAnonId')->willReturnCallback(fn ($user_id) => [$user_id => 'anon_' . $user_id]);
        $core->method('getQueries')->willReturn($queries);

        // The vendor js/css files aren't built in the unit test environment
        $output = $this->getMockBuilder(NullOutput::class)
            ->setConstructorArgs([$core])
            ->onlyMethods(['timestampResource'])
            ->getMock();
        $output->method('timestampResource')->willReturn('');
        $core->method('getOutput')->willReturn($output);

        $gradeable = $this->createMockModel(Gradeable::class);
        $gradeable->method('getId')->willReturn('hw1');
        $gradeable->method('getComponents')->willReturn([]);
        $gradeable->method('isTeamAssignment')->willReturn(false);
        $gradeable->method('canStudentDownload')->willReturn($student_download);

        $auto_graded_gradeable = $this->createMockModel(AutoGradedGradeable::class);
        $auto_graded_gradeable->method('getActiveVersion')->willReturn(1);
        $graded_gradeable = $this->createMockModel(GradedGradeable::class);
        $graded_gradeable->method('getGradeable')->willReturn($gradeable);
        $graded_gradeable->method('getAutoGradedGradeable')->willReturn($auto_graded_gradeable);

        $ta_graded_gradeable = $this->createMockModel(TaGradedGradeable::class);
        $ta_graded_gradeable->method('getGradedGradeable')->willReturn($graded_gradeable);
        $ta_graded_gradeable->method('getVisibleGraders')->willReturn([]);
        $ta_graded_gradeable->method('getAttachments')->willReturn([]);
        $ta_graded_gradeable->method('getOverallComments')->willReturn([]);

        $view = new AutoGradingView($core, $output);
        $view->showTAResults($ta_graded_gradeable, false, []);

        $twig_output = $output->getTwigOutput();
        $this->assertCount(1, $twig_output);
        $this->assertSame('autograding/TAResults.twig', $twig_output[0][0]);
        $this->assertCount(1, $twig_output[0][1]['uploaded_imgs']);
        return $twig_output[0][1]['img_annotation_paths'];
    }

    public function testStudentSeesAnnotationsWhenDownloadAllowed(): void {
        $this->assertSame(['page_1.png'], array_keys($this->getAnnotationPaths(false, true)));
    }

    public function testStudentDoesNotSeeAnnotationsWhenDownloadDisabled(): void {
        $this->assertSame([], $this->getAnnotationPaths(false, false));
    }

    public function testGraderSeesAnnotationsWhenDownloadDisabled(): void {
        $this->assertSame(['page_1.png'], array_keys($this->getAnnotationPaths(true, false)));
    }
}
